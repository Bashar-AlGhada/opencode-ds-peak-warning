import { DEFAULT_GUARD_ENABLED, DEFAULT_RANGES, coercePanelVisible } from "../src/config.ts"
import { DEFAULT_STATUS_PROVIDERS, modelFromSelectionEvent, resolveStatusProviders, statusProviderMatches } from "../src/provider.ts"
import {
  appliesOnDay,
  beijingDayOfWeek,
  contains,
  formatDays,
  formatDuration,
  formatMinutes,
  localMinutes,
  migrateLegacyRanges,
  minutesUntilStart,
  nextOccurrence,
  nextTransition,
  parseRange,
  sanitizeRanges,
  statusAt,
  statusForDate,
  toMinutes,
  utcMinutes,
} from "../src/ranges.ts"

let failures = 0

function check(name, actual, expected) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) {
    failures++
    console.error(`FAIL ${name}: got ${a}, expected ${e}`)
  } else {
    console.log(`ok   ${name}`)
  }
}

const M = (hh) => toMinutes(hh)
const d = (iso) => new Date(iso)
const peakAt = (time) => statusAt(DEFAULT_RANGES, M(time)).peak

// --- statusAt: pure time-of-day against defaults (ignores day patterns) ---
check("00:59 off-peak", peakAt("00:59"), false)
check("01:00 peak (inclusive start)", peakAt("01:00"), true)
check("03:59 peak", peakAt("03:59"), true)
check("04:00 off-peak (exclusive end)", peakAt("04:00"), false)
check("05:59 off-peak", peakAt("05:59"), false)
check("06:00 peak (second window)", peakAt("06:00"), true)
check("09:59 peak", peakAt("09:59"), true)
check("10:00 off-peak (exclusive end)", peakAt("10:00"), false)
check("23:59 off-peak", peakAt("23:59"), false)
check("empty ranges -> always off-peak", statusAt([], M("02:00")).peak, false)
check("statusAt returns matching range (with days)", statusAt(DEFAULT_RANGES, M("02:00")), {
  peak: true,
  range: { start: "01:00", end: "04:00", days: [1, 2, 3, 4, 5] },
})

// --- beijingDayOfWeek (0=Sun..6=Sat); 2026-08-21 Fri .. 08-24 Mon ---
check("dow Fri", beijingDayOfWeek(d("2026-08-21T02:00:00Z")), 5)
check("dow Sat", beijingDayOfWeek(d("2026-08-22T02:00:00Z")), 6)
check("dow Sun", beijingDayOfWeek(d("2026-08-23T02:00:00Z")), 0)
check("dow Mon", beijingDayOfWeek(d("2026-08-24T02:00:00Z")), 1)
check("Fri 15:59Z still Fri in Beijing", beijingDayOfWeek(d("2026-08-21T15:59:00Z")), 5)
check("Fri 16:00Z -> Sat in Beijing", beijingDayOfWeek(d("2026-08-21T16:00:00Z")), 6)
check("Sun 15:59Z still Sun in Beijing", beijingDayOfWeek(d("2026-08-23T15:59:00Z")), 0)
check("Sun 16:00Z -> Mon in Beijing", beijingDayOfWeek(d("2026-08-23T16:00:00Z")), 1)

// --- appliesOnDay ---
const monOnly = { start: "01:00", end: "02:00", days: [1] }
check("no days applies every day", appliesOnDay({ start: "01:00", end: "02:00" }, 6), true)
check("Mon-only on Monday", appliesOnDay(monOnly, 1), true)
check("Mon-only on Sunday", appliesOnDay(monOnly, 0), false)
check("Mon-only on Saturday", appliesOnDay(monOnly, 6), false)

// --- statusForDate: time-of-day AND Beijing weekday must match ---
check("weekday Wed morning peaks", statusForDate(d("2026-08-26T02:30:00Z"), DEFAULT_RANGES).peak, true)
check("weekday midday off", statusForDate(d("2026-08-26T12:00:00Z"), DEFAULT_RANGES).peak, false)
check("Saturday morning off (day pattern)", statusForDate(d("2026-08-29T02:30:00Z"), DEFAULT_RANGES).peak, false)
check("Sunday morning off (day pattern)", statusForDate(d("2026-08-23T02:00:00Z"), DEFAULT_RANGES).peak, false)
check("Friday morning can peak", statusForDate(d("2026-08-28T03:30:00Z"), DEFAULT_RANGES).peak, true)
const sunOnly = [{ start: "06:00", end: "08:00", days: [0] }]
check("Sun-only window peaks on Sunday", statusForDate(d("2026-08-30T07:00:00Z"), sunOnly).peak, true)
check("Sun-only window dead on Monday", statusForDate(d("2026-08-24T07:00:00Z"), sunOnly).peak, false)
const friNight = [{ start: "14:00", end: "18:00", days: [5] }]
check("Fri window peaks before Beijing midnight", statusForDate(d("2026-08-28T15:59:00Z"), friNight).peak, true)
check("same window dies at Beijing midnight", statusForDate(d("2026-08-28T16:00:00Z"), friNight).peak, false)
const everydayWrap = [{ start: "22:00", end: "02:00" }]
check("every-day window works on weekends too", statusForDate(d("2026-08-29T23:00:00Z"), everydayWrap).peak, true)

// --- nextTransition: real-moment scan honoring day patterns ---
check(
  "Wed 03:30Z -> off-peak at 04:00Z",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T03:30:00Z")),
  { at: d("2026-08-26T04:00:00Z"), to: false },
)
check(
  "Wed 00:30Z -> peak at 01:00Z",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T00:30:00Z")),
  { at: d("2026-08-26T01:00:00Z"), to: true },
)
check(
  "Wed 05:30Z -> peak at 06:00Z",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T05:30:00Z")),
  { at: d("2026-08-26T06:00:00Z"), to: true },
)
check(
  "Wed 10:30Z -> next-day peak Thu 01:00Z",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T10:30:00Z")),
  { at: d("2026-08-27T01:00:00Z"), to: true },
)
check(
  "Wed 04:00Z boundary -> peak at 06:00Z",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T04:00:00Z")),
  { at: d("2026-08-26T06:00:00Z"), to: true },
)
check(
  "Wed 23:00Z -> Thu 01:00Z peak",
  nextTransition(DEFAULT_RANGES, d("2026-08-26T23:00:00Z")),
  { at: d("2026-08-27T01:00:00Z"), to: true },
)
check(
  "Sat morning skips weekend -> Mon 01:00Z peak",
  nextTransition(DEFAULT_RANGES, d("2026-08-29T02:30:00Z")),
  { at: d("2026-08-31T01:00:00Z"), to: true },
)
check(
  "Fri afternoon crosses into weekend -> Mon 01:00Z peak",
  nextTransition(DEFAULT_RANGES, d("2026-08-28T14:30:00Z")),
  { at: d("2026-08-31T01:00:00Z"), to: true },
)
check(
  "Fri-only UTC window straddling midnight: starts at Beijing Fri 00:00 (Thu 16:00Z)",
  nextTransition(friNight, d("2026-08-27T15:00:00Z")),
  { at: d("2026-08-27T16:00:00.000Z"), to: true },
)
check(
  "Fri-only night window dies at Beijing midnight before its UTC end",
  nextTransition(friNight, d("2026-08-28T15:30:00Z")),
  { at: d("2026-08-28T16:00:00.000Z"), to: false },
)
check(
  "window-less list never flips",
  nextTransition([], d("2026-08-29T12:00:00Z")).to,
  false,
)

// --- nextOccurrence: per-window countdown across days ---
check(
  "Wed midday -> Thu 01:00Z (780m, 1 day away)",
  nextOccurrence(DEFAULT_RANGES[0], d("2026-08-26T12:00:00Z")),
  { active: false, minutes: 780, daysAway: 1 },
)
check(
  "inside window -> active",
  nextOccurrence(DEFAULT_RANGES[0], d("2026-08-26T02:00:00Z")),
  { active: true, minutes: 0, daysAway: 0 },
)
check(
  "Saturday -> Monday 01:00Z (2220m, 2 days away)",
  nextOccurrence(DEFAULT_RANGES[0], d("2026-08-29T12:00:00Z")),
  { active: false, minutes: 2220, daysAway: 2 },
)
check(
  "Sat-only wrap window active on Beijing Saturday morning (Fri 23:00Z)",
  nextOccurrence({ start: "22:00", end: "02:00", days: [6] }, d("2026-08-28T23:00:00Z")),
  { active: true, minutes: 0, daysAway: 0 },
)
check(
  "Sat-only wrap window starts at Fri 22:00Z (Beijing Sat 06:00)",
  nextOccurrence({ start: "22:00", end: "02:00", days: [6] }, d("2026-08-28T20:00:00Z")),
  { active: false, minutes: 120, daysAway: 0 },
)
check(
  "Monday vs Sun-only window -> next Sunday 06:00Z",
  nextOccurrence(sunOnly[0], d("2026-08-24T07:00:00Z")),
  { active: false, minutes: 8580, daysAway: 6 },
)
check(
  "all-day window always active",
  nextOccurrence({ start: "00:00", end: "00:00" }, d("2026-08-29T12:00:00Z")),
  { active: true, minutes: 0, daysAway: 0 },
)

// --- minutesUntilStart (pure time-of-day primitive) ---
check("next 00:00 -> 01:00 (60m)", minutesUntilStart(DEFAULT_RANGES[0], M("00:00")), { active: false, minutes: 60 })
check("next 00:59 -> 01:00 (1m)", minutesUntilStart(DEFAULT_RANGES[0], M("00:59")), { active: false, minutes: 1 })
check("next 01:00 -> active", minutesUntilStart(DEFAULT_RANGES[0], M("01:00")), { active: true, minutes: 0 })
check("next 04:00 -> next day 01:00 (1260m)", minutesUntilStart(DEFAULT_RANGES[0], M("04:00")), { active: false, minutes: 1260 })
check("next wrap 23:30 -> active", minutesUntilStart(everydayWrap[0], M("23:30")), { active: true, minutes: 0 })

// --- formatDays ---
check("formatDays Mon-Fri run", formatDays([1, 2, 3, 4, 5]), "Mon-Fri")
check("formatDays weekend pair", formatDays([0, 6]), "Sun,Sat")
check("formatDays single day", formatDays([3]), "Wed")
check("formatDays unsorted input", formatDays([5, 1, 3]), "Mon,Wed,Fri")
check("formatDays every day -> empty", formatDays([0, 1, 2, 3, 4, 5, 6]), "")
check("formatDays undefined -> empty", formatDays(undefined), "")

// --- contains boundary semantics ---
check("contains 01:00 in 01:00-04:00", contains(M("01:00"), DEFAULT_RANGES[0]), true)
check("contains 03:59 in 01:00-04:00", contains(M("03:59"), DEFAULT_RANGES[0]), true)
check("contains 04:00 exclusive", contains(M("04:00"), DEFAULT_RANGES[0]), false)
check("contains 00:59 outside", contains(M("00:59"), DEFAULT_RANGES[0]), false)
check("contains 00:00 in wrap window", contains(M("00:00"), everydayWrap[0]), true)
check("contains 02:00 exclusive in wrap", contains(M("02:00"), everydayWrap[0]), false)
check("contains all-day always true", contains(M("12:34"), { start: "00:00", end: "00:00" }), true)

// --- parseRange ---
check("parse simple", parseRange("01:00-04:00"), { start: "01:00", end: "04:00" })
check("parse with spaces", parseRange(" 01:00 - 04:00 "), { start: "01:00", end: "04:00" })
check("parse en-dash", parseRange("22:00–02:00"), { start: "22:00", end: "02:00" })
check("parse em-dash", parseRange("22:00—02:00"), { start: "22:00", end: "02:00" })
check("parse midnight full-day", parseRange("00:00-00:00"), { start: "00:00", end: "00:00" })
check("parse single-digit hours", parseRange("1:00-4:00"), { start: "1:00", end: "4:00" })
check("parse weekdays range", parseRange("06:00-10:00 Mon-Fri"), {
  start: "06:00",
  end: "10:00",
  days: [1, 2, 3, 4, 5],
})
check("parse comma weekend list", parseRange("14:00-16:00 sat,sun"), {
  start: "14:00",
  end: "16:00",
  days: [0, 6],
})
check("parse single day", parseRange("20:00-21:00 Wed"), { start: "20:00", end: "21:00", days: [3] })
check("parse lowercase days", parseRange("01:00-02:00 mon-fri"), {
  start: "01:00",
  end: "02:00",
  days: [1, 2, 3, 4, 5],
})
check("parse dedupes days", parseRange("01:00-02:00 Mon Mon Mon"), { start: "01:00", end: "02:00", days: [1] })
check("parse rejects unknown day code", parseRange("01:00-02:00 xyz"), null)
check("parse rejects reversed day range", parseRange("01:00-02:00 sat-fri"), null)
check("parse rejects leading day spec", parseRange("mon-fri 01:00-02:00"), null)
check("parse rejects garbage suffix", parseRange("01:00-04:00 peak"), null)
check("parse rejects garbage", parseRange("garbage"), null)
check("parse rejects invalid hour", parseRange("25:00-04:00"), null)
check("parse rejects invalid minute", parseRange("01:60-04:00"), null)
check("parse rejects missing end", parseRange("01:00-"), null)
check("parse rejects single time", parseRange("01:00"), null)
check("parse rejects empty", parseRange("  "), null)

// --- sanitizeRanges ---
check("sanitize keeps valid", sanitizeRanges([{ start: "01:00", end: "04:00" }]), [
  { start: "01:00", end: "04:00" },
])
check("sanitize drops legacy status field", sanitizeRanges([{ start: "01:00", end: "04:00", status: "peak" }]), [
  { start: "01:00", end: "04:00" },
])
check("sanitize keeps and normalizes days", sanitizeRanges([{ start: "06:00", end: "10:00", days: [6, 0, 0] }]), [
  { start: "06:00", end: "10:00", days: [0, 6] },
])
check("sanitize drops non-array days", sanitizeRanges([{ start: "06:00", end: "10:00", days: "mon" }]), [])
check("sanitize drops all-invalid days", sanitizeRanges([{ start: "06:00", end: "10:00", days: ["x"] }]), [])
check("sanitize filters out-of-range days", sanitizeRanges([{ start: "06:00", end: "10:00", days: [1, 9, -2] }]), [
  { start: "06:00", end: "10:00", days: [1] },
])
check("sanitize drops invalid times", sanitizeRanges([{ start: "nope", end: "x" }, { start: "01:00", end: "25:00" }]), [])
check("sanitize drops non-objects", sanitizeRanges([null, "hi", 42, undefined]), [])
check("sanitize drops missing fields", sanitizeRanges([{ start: "01:00" }, { end: "04:00" }, {}]), [])
check("sanitize empty input", sanitizeRanges([]), [])

// --- migrateLegacyRanges (pre-day-pattern saves adopt the weekday rule) ---
check("legacy window gains weekday pattern", migrateLegacyRanges([{ start: "01:00", end: "04:00" }], [1, 2, 3, 4, 5]), [
  { start: "01:00", end: "04:00", days: [1, 2, 3, 4, 5] },
])
check("window with days untouched", migrateLegacyRanges([{ start: "22:00", end: "02:00", days: [0, 6] }], [1]), [
  { start: "22:00", end: "02:00", days: [0, 6] },
])
check("migrate empty list", migrateLegacyRanges([], [1]), [])

// --- toMinutes / formatMinutes ---
check("toMinutes 00:00 -> 0", toMinutes("00:00"), 0)
check("toMinutes 23:59 -> 1439", toMinutes("23:59"), 1439)
check("toMinutes 1:30 -> 90", toMinutes("1:30"), 90)
check("formatMinutes 0 -> 00:00", formatMinutes(0), "00:00")
check("formatMinutes 1439 -> 23:59", formatMinutes(1439), "23:59")
check("formatMinutes 1440 wraps -> 00:00", formatMinutes(1440), "00:00")
check("formatMinutes -1 wraps -> 23:59", formatMinutes(-1), "23:59")

// --- utcMinutes reflects the real UTC clock ---
const now = new Date()
check("utcMinutes matches getUTC*", utcMinutes(now), now.getUTCHours() * 60 + now.getUTCMinutes())

// --- clock: minute alignment + staleness watchdog (sleep/long-run fix) ---
import { CLOCK_ALIGN_BUFFER_MS, CLOCK_WATCHDOG_MS } from "../src/config.ts"
import { PEAK_SOON_MS, isClockStale, msUntilNextTick, statusTone } from "../src/status.ts"
check("tick aligns past minute boundary", msUntilNextTick(60_000) > 60_000, true)
check("tick delay includes buffer", msUntilNextTick(0), 60_000 + CLOCK_ALIGN_BUFFER_MS)
check("tick mid-minute delay", msUntilNextTick(90_000), 30_000 + CLOCK_ALIGN_BUFFER_MS)
check("fresh clock not stale", isClockStale(new Date(Date.now() - 10_000)), false)
check("old clock stale after sleep", isClockStale(new Date(Date.now() - (CLOCK_WATCHDOG_MS + 1_000))), true)

// --- panel visibility: KV toggle wins, anything non-boolean falls back ---
check("panel KV true wins", coercePanelVisible(true, false), true)
check("panel KV false wins", coercePanelVisible(false, true), false)
check("panel missing KV falls back", coercePanelVisible(undefined, true), true)
check("panel wrong-type KV falls back", coercePanelVisible("shown", true), true)
check("guard default enabled", DEFAULT_GUARD_ENABLED, true)

// --- model-aware status display ---
check("status defaults to DeepSeek", DEFAULT_STATUS_PROVIDERS, ["deepseek"])
check("status matches DeepSeek provider", statusProviderMatches("deepseek", "deepseek-chat"), true)
check("status matches DeepSeek model", statusProviderMatches("opencode", "deepseek-chat"), true)
check("status skips OpenAI Astra", statusProviderMatches("openai", "gpt-6.0-codex"), false)
check("empty status providers match all", statusProviderMatches("openai", "gpt-6.0-codex", []), true)
check("missing status providers use default", resolveStatusProviders(undefined), ["deepseek"])
check("empty status providers remain opt-in all", resolveStatusProviders([]), [])
check("invalid status providers use default", resolveStatusProviders([42, ""]), ["deepseek"])
check("status providers trim whitespace", resolveStatusProviders([" deepseek "]), ["deepseek"])
check(
  "model selection event exposes its live model",
  modelFromSelectionEvent({ data: { sessionID: "ses_1", model: { providerID: "openai", id: "gpt-6.0-codex" } } }),
  { sessionID: "ses_1", providerID: "openai", modelID: "gpt-6.0-codex" },
)

// --- status tone: red peak, green off-peak, yellow when peak < 30 min away ---
const toneNow = d("2026-08-26T02:00:00Z") // Wed, inside the 01:00-04:00 UTC window
const toneAt = (minutes) => new Date(toneNow.getTime() + minutes * 60_000)
check("tone peak", statusTone(true, { at: toneAt(60), to: false }, toneNow), "peak")
check("tone peak flip in 20m is soon", statusTone(false, { at: toneAt(20), to: true }, toneNow), "soon")
check("tone peak flip in 29m is soon", statusTone(false, { at: toneAt(29), to: true }, toneNow), "soon")
check("tone peak flip at exactly 30m is off-peak", statusTone(false, { at: toneAt(30), to: true }, toneNow), "off-peak")
check("tone peak flip in 31m is off-peak", statusTone(false, { at: toneAt(31), to: true }, toneNow), "off-peak")
check("tone flip into off-peak stays green", statusTone(false, { at: toneAt(10), to: false }, toneNow), "off-peak")
check("soon window is 30 minutes", PEAK_SOON_MS, 30 * 60_000)

// --- guard: DeepSeek-only peak gate with cooldown debounce ---
import {
  formatCooldown,
  isCooldownActive,
  matchesProviders,
  parseConfigModel,
  sanitizeGuardSettings,
  shouldGuard,
} from "../src/guard.ts"
const guardBase = { enabled: true, mode: "block", cooldownMs: 5 * 60_000, providers: ["deepseek"] }
const wedPeak = d("2026-08-26T02:30:00Z") // Wed, inside 01:00-04:00 UTC window
const wedOff = d("2026-08-26T12:00:00Z")
check("guard fires on peak+deepseek", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: 0 }).guard, true)
check("guard reason peak", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: 0 }).reason, "peak")
check("guard quiet off-peak", shouldGuard({ now: wedOff, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: 0 }).guard, false)
check("guard skips non-deepseek", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "anthropic", modelID: "claude", settings: guardBase, lastAck: 0 }).reason, "non-target-model")
check("guard respects cooldown", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: wedPeak.getTime() - 60_000 }).reason, "cooldown")
check("guard re-fires after cooldown", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: wedPeak.getTime() - 10 * 60_000 }).guard, true)
check("guard disabled never fires", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: { ...guardBase, enabled: false }, lastAck: 0 }).reason, "disabled")
check("cooldown off always asks", isCooldownActive(wedPeak.getTime() - 1_000, 0, wedPeak.getTime()), false)
check("matches deepseek model id", matchesProviders("opencode", "deepseek-chat", ["deepseek"]), true)
check("no match other provider", matchesProviders("anthropic", "claude", ["deepseek"]), false)
check("empty providers matches all", matchesProviders("anthropic", "claude", []), true)
check("parse provider/model", parseConfigModel("deepseek/deepseek-chat"), { providerID: "deepseek", modelID: "deepseek-chat" })
check("parse model with variant", parseConfigModel("deepseek/deepseek-chat@high"), { providerID: "deepseek", modelID: "deepseek-chat" })
check("sanitize guard defaults", sanitizeGuardSettings(undefined, guardBase), guardBase)
check("sanitize guard mode", sanitizeGuardSettings({ ...guardBase, mode: "warn" }, guardBase).mode, "warn")
check("sanitize guard bad mode", sanitizeGuardSettings({ ...guardBase, mode: "nope" }, guardBase).mode, "block")
check("formatCooldown off", formatCooldown(0), "off")
check("formatCooldown 5m", formatCooldown(5 * 60_000), "5m")
check("warn mode never blocks", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: { ...guardBase, mode: "warn" }, lastAck: 0 }).guard, false)
check("warn mode flags warn", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: { ...guardBase, mode: "warn" }, lastAck: 0 }).warn, true)
check("block mode does not flag warn", shouldGuard({ now: wedPeak, ranges: DEFAULT_RANGES, providerID: "deepseek", modelID: "deepseek-chat", settings: guardBase, lastAck: 0 }).warn, false)

// --- guard-intercept: model resolution, labels, client wrapper ---
import {
  confirmDialogCallbacks,
  createConfirmSettlement,
  formatLastActivity,
  installPromptGuard,
  peakSummary,
  resolvePromptModel,
} from "../src/guard-intercept.ts"

// First-wins settlement primitive.
{
  const s = createConfirmSettlement()
  s.done(true)
  s.done(false)
  check("settlement first wins", await s.promise, true)
}

// Faithful host simulation: dialog.clear() synchronously fires the onClose
// handler registered via dialog.replace (this is what made every confirm
// resolve as cancel before the settle-first fix).
function mockDialogHost() {
  const events = []
  let onClose
  const inner = createConfirmSettlement()
  const settle = {
    done: (v) => { events.push(`done:${v}`); inner.done(v) },
    promise: inner.promise,
  }
  const api = {
    ui: {
      dialog: {
        replace: (_render, onCl) => { onClose = onCl },
        clear: () => { events.push("clear"); onClose?.() },
      },
    },
  }
  return { api, settle, events }
}

{
  const { api, settle, events } = mockDialogHost()
  const cb = confirmDialogCallbacks(api, settle)
  api.ui.dialog.replace(() => ({}), cb.onClose)
  cb.onConfirm()
  // The trailing done:false is the onClose backstop firing on clear — it must
  // lose the first-wins race (proven by the resolve check below).
  check("confirm settles before clear", events, ["done:true", "clear", "done:false"])
  check("confirm resolves true", await settle.promise, true)
}

{
  const { api, settle, events } = mockDialogHost()
  const cb = confirmDialogCallbacks(api, settle)
  api.ui.dialog.replace(() => ({}), cb.onClose)
  cb.onCancel()
  check("cancel settles before clear", events, ["done:false", "clear", "done:false"])
  check("cancel resolves false", await settle.promise, false)
}

{
  const { api, settle } = mockDialogHost()
  const cb = confirmDialogCallbacks(api, settle)
  api.ui.dialog.replace(() => ({}), cb.onClose)
  cb.onClose()
  check("stolen dialog resolves false", await settle.promise, false)
}

const ALWAYS_PEAK = [{ start: "00:00", end: "00:00" }] // all-day window peaks at any time
const NEVER_PEAK = []

// resolvePromptModel precedence: call args > top-level spread > session > default
const fakeDeps = {
  getSessionModel: () => ({ providerID: "anthropic", modelID: "claude" }),
  getDefaultModel: () => ({ providerID: "openai", modelID: "gpt" }),
}
check("model prefers nested args", resolvePromptModel({ model: { providerID: "deepseek", modelID: "deepseek-chat" }, sessionID: "s" }, fakeDeps), { providerID: "deepseek", modelID: "deepseek-chat" })
check("model reads top-level spread", resolvePromptModel({ providerID: "deepseek", modelID: "deepseek-chat", sessionID: "s" }, fakeDeps), { providerID: "deepseek", modelID: "deepseek-chat" })
check("model falls back to session", resolvePromptModel({ sessionID: "s" }, fakeDeps), { providerID: "anthropic", modelID: "claude" })
check("model falls back to default", resolvePromptModel({ sessionID: "s" }, { getSessionModel: () => ({}), getDefaultModel: () => ({ providerID: "deepseek", modelID: "deepseek-chat" }) }), { providerID: "deepseek", modelID: "deepseek-chat" })
check("model unknown when all empty", resolvePromptModel({ sessionID: "s" }, { getSessionModel: () => { throw new Error("kv down") }, getDefaultModel: () => { throw new Error("cfg down") } }), { providerID: undefined, modelID: undefined })

// formatLastActivity labels (sidebar indication)
check("activity null -> null", formatLastActivity(null), null)
check("activity sent", formatLastActivity({ at: wedPeak.getTime(), outcome: "sent", reason: "peak-ack" })?.startsWith("last sent"), true)
check("activity cancelled", formatLastActivity({ at: wedPeak.getTime(), outcome: "cancelled", reason: "peak" })?.startsWith("last cancelled"), true)
check("activity warned", formatLastActivity({ at: wedPeak.getTime(), outcome: "warned", reason: "peak" })?.startsWith("last warned"), true)
check("activity blocked", formatLastActivity({ at: wedPeak.getTime(), outcome: "blocked", reason: "confirm-pending" })?.startsWith("last blocked"), true)
check("activity pass off-peak", formatLastActivity({ at: wedPeak.getTime(), outcome: "pass", reason: "off-peak" }), "off-peak")
check("activity pass non-target", formatLastActivity({ at: wedPeak.getTime(), outcome: "pass", reason: "non-target-model" }), "non-DeepSeek")
check("activity pass cooldown", formatLastActivity({ at: wedPeak.getTime(), outcome: "pass", reason: "cooldown" })?.startsWith("cooldown until"), true)
check("summary peaks", peakSummary(ALWAYS_PEAK, wedPeak).includes("PEAK"), true)
check("summary off-peak", peakSummary(NEVER_PEAK, wedOff).includes("off-peak"), true)

// Mock TUI api for the client wrapper. Slash/shell paths are structurally
// untouched: only session.prompt/promptAsync are wrapped.
function mockApi({ sessionModel, defaultModel } = {}) {
  const calls = { toast: [], notify: [], ack: [], dialog: 0 }
  const sent = []
  const origPrompt = async (...a) => {
    sent.push(a)
    return { ok: true }
  }
  const origAsync = async (...a) => {
    sent.push(a)
    return { ok: true, async: true }
  }
  const origCommand = async () => ({ ok: true })
  const session = { prompt: origPrompt, promptAsync: origAsync, command: origCommand, shell: origCommand }
  let disposeFn
  const api = {
    client: { session },
    state: { session: { get: () => sessionModel }, config: { model: defaultModel } },
    ui: {
      toast: (t) => calls.toast.push(t),
      dialog: { replace: () => { calls.dialog++ }, clear: () => {} },
    },
    kv: { get: () => undefined, set: () => {} },
    lifecycle: { onDispose: (fn) => { disposeFn = fn; return () => {} } },
    event: { on: () => () => {} },
  }
  return { api, session, calls, sent, origPrompt, origAsync, origCommand, dispose: () => disposeFn?.() }
}

function guardDeps(ctx, { confirmImpl } = {}) {
  let confirmCalls = 0
  const tracker = { get confirmCalls() { return confirmCalls } }
  return {
    deps: {
      ranges: () => ctx.ranges,
      settings: () => ctx.settings,
      lastAck: () => ctx.lastAck,
      ack: (at) => { ctx.lastAck = at ?? Date.now(); ctx.calls.ack.push(ctx.lastAck) },
      showConfirm: async (s) => { confirmCalls++; return confirmImpl ? confirmImpl(s) : true },
      notify: (a) => ctx.calls.notify.push(a),
      toast: (message, variant) => ctx.calls.toast.push({ message, variant }),
      getSessionModel: (id) => {
        const m = ctx.api.state.session.get(id)?.model
        return m ? { providerID: m.providerID, modelID: m.id } : {}
      },
      getDefaultModel: () => parseConfigModel(ctx.api.state.config.model),
    },
    tracker,
  }
}

const DS_ARGS = { sessionID: "s", model: { providerID: "deepseek", modelID: "deepseek-chat" }, parts: [] }

// Disabled guard passes through without any dialog.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase, enabled: false }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  check("disabled installs", handle.installed, true)
  const res = await ctx.session.prompt(DS_ARGS)
  check("disabled sends", res.ok, true)
  check("disabled asks nothing", tracker.confirmCalls, 0)
  check("disabled notifies pass", ctx.calls.notify.at(-1)?.reason, "disabled")
  handle.uninstall()
}

// Off-peak passes through.
{
  const ctx = { ...mockApi(), ranges: NEVER_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt(DS_ARGS)
  check("off-peak sends", ctx.sent.length, 1)
  check("off-peak asks nothing", tracker.confirmCalls, 0)
  handle.uninstall()
}

// Non-DeepSeek passes through with a recorded reason (visible in the panel).
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt({ sessionID: "s", model: { providerID: "anthropic", modelID: "claude" } })
  check("non-target sends", ctx.sent.length, 1)
  check("non-target reason recorded", ctx.calls.notify.at(-1)?.reason, "non-target-model")
  handle.uninstall()
}

// Block + confirm: original is NOT called until the user confirms.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  const pending = ctx.session.prompt(DS_ARGS)
  check("gated waits for confirm", ctx.sent.length, 0)
  check("gated asks once", tracker.confirmCalls, 1)
  await pending
  check("confirmed sends once", ctx.sent.length, 1)
  check("confirm starts cooldown", ctx.calls.ack.length, 1)
  await ctx.session.prompt(DS_ARGS)
  check("cooldown skips second dialog", tracker.confirmCalls, 1)
  check("cooldown sends", ctx.sent.length, 2)
  handle.uninstall()
}

// Cancel rejects and never sends.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps } = guardDeps(ctx, { confirmImpl: () => false })
  const handle = installPromptGuard(ctx.api, deps)
  const err = await ctx.session.prompt(DS_ARGS).then(() => null, (e) => e)
  check("cancel rejects", /peak/i.test(err?.message ?? ""), true)
  check("cancel never sends", ctx.sent.length, 0)
  check("cancel recorded", ctx.calls.notify.at(-1)?.outcome, "cancelled")
  handle.uninstall()
}

// Dialog plumbing failure fails OPEN (never strands the user).
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps } = guardDeps(ctx, { confirmImpl: () => { throw new Error("dialog down") } })
  const handle = installPromptGuard(ctx.api, deps)
  const res = await ctx.session.prompt(DS_ARGS)
  check("dialog failure fails open", res.ok, true)
  handle.uninstall()
}

// Concurrent gated sends: second rejects immediately, single dialog.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  let release
  const gate = new Promise((r) => { release = r })
  const { deps, tracker } = guardDeps(ctx, { confirmImpl: () => gate })
  const handle = installPromptGuard(ctx.api, deps)
  const first = ctx.session.prompt(DS_ARGS)
  const secondErr = await ctx.session.prompt(DS_ARGS).then(() => null, (e) => e)
  check("concurrent rejects while pending", /pending/i.test(secondErr?.message ?? ""), true)
  check("concurrent single dialog", tracker.confirmCalls, 1)
  release(true)
  await first
  check("first sends after confirm", ctx.sent.length, 1)
  handle.uninstall()
}

// Warn mode never blocks, toasts once per cooldown window.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase, mode: "warn" }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt(DS_ARGS)
  await ctx.session.prompt(DS_ARGS)
  check("warn sends", ctx.sent.length, 2)
  check("warn asks nothing", tracker.confirmCalls, 0)
  check("warn toasts once", ctx.calls.toast.filter((t) => /peak/i.test(t.message)).length, 1)
  handle.uninstall()
}

// Warn mode with cooldown off toasts on every send.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase, mode: "warn", cooldownMs: 0 }, lastAck: 0 }
  const { deps } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt(DS_ARGS)
  await ctx.session.prompt(DS_ARGS)
  check("warn cooldown 0 toasts every time", ctx.calls.toast.filter((t) => /peak/i.test(t.message)).length, 2)
  handle.uninstall()
}

// Unknown model fails open (no silent block, no dialog).
{
  const ctx = mockApi({ sessionModel: undefined, defaultModel: undefined })
  Object.assign(ctx, { ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 })
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt({ sessionID: "s", parts: [] })
  check("unknown model sends", ctx.sent.length, 1)
  check("unknown model asks nothing", tracker.confirmCalls, 0)
  handle.uninstall()
}

// Cooldown 0 asks on every prompt (but slash/settings still work: they never
// reach session.prompt at all).
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase, cooldownMs: 0 }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  await ctx.session.prompt(DS_ARGS)
  await ctx.session.prompt(DS_ARGS)
  check("cooldown 0 asks every time", tracker.confirmCalls, 2)
  check("command method untouched", ctx.session.command === ctx.origCommand, true)
  await ctx.session.command({ sessionID: "s", command: "sessions" })
  check("slash path unaffected", tracker.confirmCalls, 2)
  handle.uninstall()
}

// Uninstall and dispose restore the original methods.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  check("wrapped after install", ctx.session.prompt !== ctx.origPrompt, true)
  handle.uninstall()
  check("uninstall restores prompt", ctx.session.prompt === ctx.origPrompt, true)
  await ctx.session.prompt(DS_ARGS)
  check("post-uninstall sends freely", ctx.sent.length, 1)
  check("post-uninstall asks nothing", tracker.confirmCalls, 0)
}

// Dispose hook restores too.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps } = guardDeps(ctx)
  installPromptGuard(ctx.api, deps)
  ctx.dispose()
  check("dispose restores prompt", ctx.session.prompt === ctx.origPrompt, true)
}

// Client rotation re-patches the new object.
{
  const ctx = { ...mockApi(), ranges: ALWAYS_PEAK, settings: { ...guardBase }, lastAck: 0 }
  const { deps, tracker } = guardDeps(ctx)
  const handle = installPromptGuard(ctx.api, deps)
  const replacement = async () => ({ ok: "new" })
  ctx.api.client = { session: { prompt: replacement, command: async () => ({}) } }
  handle.ensurePatched()
  check("rotation re-patches", ctx.api.client.session.prompt !== replacement, true)
  const pending = ctx.api.client.session.prompt(DS_ARGS)
  check("rotated client still guards", tracker.confirmCalls, 1)
  await pending
  handle.uninstall()
}

// --- merged coverage array: built at write time, read per tick ---
import {
  beijingWeekMinute,
  buildCoverageRuns,
  coerceCoverageDoc,
  coverageFingerprint,
  isCoverageFresh,
  makeCoverageDoc,
  MINUTES_PER_WEEK,
  nextTransitionInRuns,
  statusForRuns,
  statusInRuns,
} from "../src/ranges.ts"
import {
  CLOCK_EVENT_TYPES,
  clockDiagnostics,
  gateAllows,
  poke,
  resetClockForTests,
} from "../src/clock.ts"
import { CLOCK_EVENT_GATE_MS } from "../src/config.ts"
import { peakSummaryFromRuns } from "../src/guard-intercept.ts"

check("week minute Wed 03:30Z -> Beijing Wed 11:30", beijingWeekMinute(d("2026-08-26T03:30:00Z")), 3 * 1440 + 690)
check("week minute at Beijing midnight edge", beijingWeekMinute(d("2026-08-28T16:00:00Z")), 6 * 1440 + 0)
check("defaults build 10 disjoint runs", buildCoverageRuns(DEFAULT_RANGES).length, 10)

// Overlapping every-day windows merge in the array, not in the settings.
const OVERLAP = [{ start: "01:00", end: "04:00" }, { start: "03:00", end: "06:00" }, { start: "06:00", end: "08:00", days: [4] }]
{
  const runs = buildCoverageRuns(OVERLAP)
  // Daily [01-06) plus Thursday adjacency-merged [01-06)+[06-08 Thu] -> 7 runs.
  check("overlapping windows merge to 7 runs", runs.length, 7)
  check("merged Thursday covers 07:00Z", statusForRuns(runs, d("2026-08-27T07:00:00Z")), true)
  check("merged Wednesday off at 07:00Z", statusForRuns(runs, d("2026-08-26T07:00:00Z")), false)
}

// Every-day wrap plus a Thursday-only window: both fire on Thursday.
const EVERY_THU = [{ start: "22:00", end: "02:00" }, { start: "06:00", end: "08:00", days: [4] }]
{
  const runs = buildCoverageRuns(EVERY_THU)
  check("every-day + Thursday-only -> 8 runs", runs.length, 8)
  check("Thursday-only fires Thu 07:00Z", statusForRuns(runs, d("2026-08-27T07:00:00Z")), true)
  check("Thursday-only quiet Wed 07:00Z", statusForRuns(runs, d("2026-08-26T07:00:00Z")), false)
  check("every-day fires Wed 23:00Z", statusForRuns(runs, d("2026-08-26T23:00:00Z")), true)
}

check("all-day absorbs to one full-week run", buildCoverageRuns([{ start: "00:00", end: "00:00" }]), [
  { start: 0, end: MINUTES_PER_WEEK },
])
check("adjacent windows merge per day", buildCoverageRuns([{ start: "01:00", end: "02:00" }, { start: "02:00", end: "03:00" }]).length, 7)
check("empty ranges -> no runs", buildCoverageRuns([]), [])

// A UTC window straddling Beijing midnight stays continuous across it (no flip
// at midnight for every-day patterns), merging into one run per day-boundary;
// only the week edge itself splits.
{
  const runs = buildCoverageRuns([{ start: "15:30", end: "16:30" }])
  check("midnight-straddling window -> 8 runs", runs.length, 8)
  check("week-edge head run", runs[0], { start: 0, end: 30 })
  check("week-edge tail run", runs[runs.length - 1], { start: MINUTES_PER_WEEK - 30, end: MINUTES_PER_WEEK })
}

// Binary-search edge semantics (start inclusive, end exclusive).
{
  const runs = [{ start: 60, end: 120 }]
  check("run start inclusive", statusInRuns(runs, 60), true)
  check("run interior", statusInRuns(runs, 119), true)
  check("run end exclusive", statusInRuns(runs, 120), false)
  check("before run", statusInRuns(runs, 59), false)
  check("empty runs never peak", statusInRuns([], 60), false)
}

// --- fingerprint + coverage doc (persisted array, rebuild on mismatch) ---
{
  const a = makeCoverageDoc(DEFAULT_RANGES)
  check("doc fingerprint verifies", isCoverageFresh(a, DEFAULT_RANGES), true)
  check("doc stale after settings change", isCoverageFresh(a, [...DEFAULT_RANGES, { start: "20:00", end: "21:00" }]), false)
  check("fingerprint stable for equal input", coverageFingerprint(DEFAULT_RANGES), coverageFingerprint(DEFAULT_RANGES.map((r) => ({ ...r }))))
  // Round-trip through JSON (KV serialization) then coerce.
  const revived = coerceCoverageDoc(JSON.parse(JSON.stringify(a)))
  check("doc round-trips through KV", revived, a)
  check("legacy plain array rejected", coerceCoverageDoc(DEFAULT_RANGES), null)
  check("garbage rejected", coerceCoverageDoc({ v: 1, ranges: [], runs: [], fingerprint: "nope" }), null)
  check("tampered fingerprint rejected", coerceCoverageDoc({ ...a, fingerprint: "tampered" }), null)
  check("overlapping runs rejected", coerceCoverageDoc({ ...a, runs: [{ start: 0, end: 100 }, { start: 50, end: 150 }] }), null)
  check("malformed runs rejected", coerceCoverageDoc({ ...a, runs: [{ start: -1, end: 50 }] }), null)
  // Doc deep-copies: later caller mutation cannot corrupt the stored array.
  const src = [{ start: "01:00", end: "02:00" }]
  const doc = makeCoverageDoc(src)
  src[0].start = "09:00"
  src.push({ start: "10:00", end: "11:00" })
  check("doc immune to caller mutation", doc.ranges, [{ start: "01:00", end: "02:00" }])
}

// --- equivalence: array readers match the direct reference implementation ---
const EQUIV_SETS = {
  defaults: DEFAULT_RANGES,
  overlap: OVERLAP,
  everyThu: EVERY_THU,
  wrap: [{ start: "22:00", end: "02:00" }, { start: "15:30", end: "16:30", days: [6] }],
  allDay: [{ start: "00:00", end: "00:00" }],
  empty: [],
}
{
  const weekBase = d("2026-08-24T00:00:00Z").getTime() // a Monday
  for (const [name, set] of Object.entries(EQUIV_SETS)) {
    const runs = buildCoverageRuns(set)
    let mismatches = 0
    for (let m = 0; m < MINUTES_PER_WEEK; m++) {
      const at = new Date(weekBase + m * 60_000)
      if (statusForDate(at, set).peak !== statusForRuns(runs, at)) mismatches++
    }
    check(`status equivalence full week: ${name}`, mismatches, 0)
    // Transitions sampled every 6h over 3 days (covers wrap + weekend skip).
    let tMismatches = 0
    for (let h = 0; h < 72; h += 6) {
      const at = new Date(weekBase + h * 3_600_000)
      const a = nextTransition(set, at)
      const b = nextTransitionInRuns(runs, at)
      if (a.at.getTime() !== b.at.getTime() || a.to !== b.to) tMismatches++
    }
    check(`transition equivalence sampled: ${name}`, tMismatches, 0)
    // Run-count bound: each window contributes at most 2 segments per day,
    // so the array stays linear in the settings (not in the scan horizon).
    check(`run-count bound: ${name}`, runs.length <= 14 * Math.max(1, set.length), true)
  }
}

// --- summaries agree whether built from ranges or from runs ---
for (const at of [wedPeak, wedOff, d("2026-08-29T02:30:00Z")]) {
  check(`summary agreement ${at.toISOString()}`, peakSummaryFromRuns(buildCoverageRuns(DEFAULT_RANGES), at), peakSummary(DEFAULT_RANGES, at))
}
check("runs summary all-day peaks", peakSummaryFromRuns(buildCoverageRuns(ALWAYS_PEAK), wedPeak).includes("PEAK"), true)
check("runs summary empty off-peak", peakSummaryFromRuns(buildCoverageRuns(NEVER_PEAK), wedOff).includes("off-peak"), true)

// --- clock: nanosecond poke gate, counters, tiers ---
check("gate blocks inside window", gateAllows(1_000, 1_000 + CLOCK_EVENT_GATE_MS - 1), false)
check("gate allows at threshold", gateAllows(1_000, 1_000 + CLOCK_EVENT_GATE_MS), true)
{
  resetClockForTests()
  for (let i = 0; i < 1000; i++) poke("message.part.delta")
  const snap = clockDiagnostics()
  check("1k-event burst -> exactly one refresh", snap.refreshCount, 1)
  check("burst counted per type", snap.eventCounts["message.part.delta"], 1000)
  poke("custom-type")
  check("unknown sources counted too", clockDiagnostics().eventCounts["custom-type"], 1)
  check("reset leaves clock stopped", clockDiagnostics().started, false)
}
check("event tiers cover lifecycle", CLOCK_EVENT_TYPES.includes("session.updated"), true)
check("event tiers cover interaction", CLOCK_EVENT_TYPES.includes("tui.prompt.append"), true)
check("event tiers cover generation firehose", CLOCK_EVENT_TYPES.includes("message.part.delta"), true)
check("event tiers have no duplicates", new Set(CLOCK_EVENT_TYPES).size, CLOCK_EVENT_TYPES.length)

// The watchdog must fan in the ENTIRE Event["type"] union: extract every
// dotted type literal from the SDK's generated types (numeric-suffixed
// entries like "session.updated.1" are schema duplicates, not bus events)
// and enforce coverage in both directions, so a new SDK event fails loudly.
{
  const sdkTypes = readFileSync(
    join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "node_modules", "@opencode-ai", "sdk", "dist", "v2", "gen", "types.gen.d.ts"),
    "utf8",
  )
  const sdkEvents = new Set(
    [...sdkTypes.matchAll(/type: "([a-z0-9][a-z0-9._-]*)"/g)]
      .map((m) => m[1])
      .filter((t) => t.includes(".") && !/\.\d+$/.test(t)),
  )
  const missing = [...sdkEvents].filter((t) => !CLOCK_EVENT_TYPES.includes(t))
  const extra = CLOCK_EVENT_TYPES.filter((t) => !sdkEvents.has(t))
  check("watchdog covers every SDK event type", missing, [])
  check("watchdog subscribes to real event types only", extra, [])
}

// --- time boundaries: UTC clock vs Beijing calendar vs local display ---
{
  // Week-minute mapping agrees with the day + clock primitives over 10 days.
  const base = d("2026-08-24T00:00:00Z").getTime()
  let bad = 0
  for (let m = 0; m < 10 * 1440; m += 37) {
    const at = new Date(base + m * 60_000)
    const w = beijingWeekMinute(at)
    if (Math.floor(w / 1440) !== beijingDayOfWeek(at)) bad++
    if (w % 1440 !== (utcMinutes(at) + 480) % 1440) bad++
  }
  check("week-minute mapping matches dow+clock", bad, 0)
  // Sub-minute instants: both implementations drop seconds identically.
  let secBad = 0
  for (const set of [DEFAULT_RANGES, OVERLAP, EVERY_THU]) {
    const runs = buildCoverageRuns(set)
    for (let h = 0; h < 168; h++) {
      const at = new Date(base + h * 3_600_000 + 59_500) // :59.5s of every hour
      if (statusForDate(at, set).peak !== statusForRuns(runs, at)) secBad++
    }
  }
  check("seconds dropped identically by both paths", secBad, 0)
}
check("epoch maps to Thu 08:00 Beijing", beijingWeekMinute(d("1970-01-01T00:00:00Z")), 4 * 1440 + 480)
{
  // A UTC-midnight window lands on Beijing 08:00, far from any day edge.
  const runs = buildCoverageRuns([{ start: "00:00", end: "01:00" }])
  check("UTC 00:30Z peaks (Beijing 08:30)", statusForRuns(runs, d("2026-08-26T00:30:00Z")), true)
  check("UTC 01:00Z off (exclusive end)", statusForRuns(runs, d("2026-08-26T01:00:00Z")), false)
}
{
  // Beijing-midnight flip kills a day-pattern window mid-UTC-span (runs path).
  const runs = buildCoverageRuns(friNight)
  check("runs: Fri window alive 15:59Z", statusForRuns(runs, d("2026-08-28T15:59:00Z")), true)
  check("runs: Fri window dead 16:00Z", statusForRuns(runs, d("2026-08-28T16:00:00Z")), false)
}
check("local display follows the clock (UTC)", localMinutes(d("2026-08-26T02:30:00Z"), "UTC"), 150)

// --- every relative import in src/ (plus the root v2 entry) must resolve ---
// Guards against broken specifiers (e.g. ".ts" pointing at a ".tsx" file),
// which fail silently at plugin load time in opencode.
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
const repoDir = join(dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..")
const srcDir = join(repoDir, "src")
let importChecks = 0
const checkImportsOf = (dir, file) => {
  const text = readFileSync(join(dir, file), "utf8")
  const specs = [...text.matchAll(/(?:from|import)\s*["'](\.[^"']+)["']/g)].map((m) => m[1])
  for (const spec of specs) {
    importChecks++
    const target = join(dirname(join(dir, file)), spec)
    check(`import resolves: ${file} -> ${spec}`, existsSync(target) ? "ok" : "missing", "ok")
  }
}
for (const file of readdirSync(srcDir)) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  checkImportsOf(srcDir, file)
}
for (const file of readdirSync(join(srcDir, "v2"))) {
  if (!/\.(ts|tsx)$/.test(file)) continue
  checkImportsOf(srcDir, `v2/${file}`)
}
// Root entrypoints (v2 directory installs resolve `<dir>/tui`, not exports).
for (const rootEntry of ["tui.ts"]) {
  check(`root entry exists: ${rootEntry}`, existsSync(join(repoDir, rootEntry)) ? "ok" : "missing", "ok")
  checkImportsOf(repoDir, rootEntry)
}
console.log(`     (${importChecks} relative imports checked)`)

// --- v2 directory entry re-exports the dual module (not a fork) ---
{
  const rootTui = readFileSync(join(repoDir, "tui.ts"), "utf8")
  check("root tui.ts re-exports src/index.tsx", rootTui.includes("./src/index.tsx"), true)
}

// --- v2 storage keys must satisfy the host segment rule ---
// The TUI storage provider validates every path segment with
// /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/ (no colons/slashes) and throws
// `Invalid storage segment` at setup time otherwise.
{
  const kvSrc = readFileSync(join(srcDir, "v2", "kv.ts"), "utf8")
  const keys = [...kvSrc.matchAll(/storage\.store(?:<[^>]+>)?\(\s*"([^"]+)"/g)].map((m) => m[1])
  check("v2 store keys found", keys.length > 0, true)
  for (const key of keys) {
    check(
      `v2 store key valid segment: ${key}`,
      /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(key) && key !== "." && key !== "..",
      true,
    )
  }
}

// --- v2 /dspeak main menu parity with v1 ---
// The v2 promise dialog.select() has no header slot, so the main menu round
// must go through dialog.show() with the SHARED PeakDialogHeader (live
// colored status dot, UTC + local, next switch with countdown, windows
// line) above a native keyboard-driven <select>. Leaf submenus stay
// promise-based, matching v1's host-dialog leaves.
{
  const menuSrc = readFileSync(join(srcDir, "v2", "menu.tsx"), "utf8")
  const dialogsSrc = readFileSync(join(srcDir, "v2", "dialogs.tsx"), "utf8")
  const setupSrc = readFileSync(join(srcDir, "v2", "tui-v2.ts"), "utf8")
  check("v2 menu reuses shared dialog header", menuSrc.includes("PeakDialogHeader"), true)
  check("v2 menu uses native select list", /<select[\s>]/.test(menuSrc), true)
  check("v2 select has explicit height (auto collapses to 0 rows)", /<select[\s\S]*?height=\{props\.items\.length/.test(menuSrc), true)
  check("v2 menu grabs list focus on open", menuSrc.includes("focused") && menuSrc.includes("onMount"), true)
  check("v2 menu handles escape explicitly", menuSrc.includes('"escape"'), true)
  check("v2 main round uses dialog.show", dialogsSrc.includes("ctx.dialog.show("), true)
  check("v2 main options carry descriptions", dialogsSrc.includes('description: "Block or warn on prompts'), true)
  check("v2 menu ctx threads theme", dialogsSrc.includes("theme: () => PeakThemeColors"), true)
  check("v2 setup adapts theme for menu", setupSrc.includes("adaptV2Theme(context.theme)"), true)
}

// --- v2 command layer must register from a component render ---
// context.keymap.layer() is owned by the calling component: a setup()-level
// call stays ownerless (no keymap provider above setup) and the commands
// never become reachable — no palette entries, no slash completion. The
// layer must be registered from an `append: "app"` slot render (same as the
// host's built-in diff viewer), never from setup().
{
  const slotsSrc = readFileSync(join(srcDir, "v2", "slots.tsx"), "utf8")
  const setupSrc = readFileSync(join(srcDir, "v2", "tui-v2.ts"), "utf8")
  check("v2 app-slot claim exists", slotsSrc.includes('append: "app"'), true)
  check("v2 layer registers from slot render", slotsSrc.includes("registerV2Commands"), true)
  check("v2 layer NOT registered from setup", !setupSrc.includes("registerV2Commands"), true)
}
// --- v2 dual export: one module serves v1 ({id,tui}) and v2 ({id,setup}) ---
// Static text checks (no runtime import: index pulls .tsx, which strip-types
// cannot execute). Both generations must agree on the plugin id.
{
  const indexSrc = readFileSync(join(srcDir, "index.tsx"), "utf8")
  const tuiSrc = readFileSync(join(srcDir, "tui.tsx"), "utf8")
  const v2Src = readFileSync(join(srcDir, "v2", "tui-v2.ts"), "utf8")
  check("dual export exposes tui (v1)", /tui:\s*tuiModule\.tui/.test(indexSrc), true)
  check("dual export spreads v2 definition", /\.\.\.v2plugin/.test(indexSrc), true)
  check("dual export satisfies v1 module shape", /satisfies TuiPluginModule/.test(indexSrc), true)
  check("v2 definition pins v2 contract", /satisfies Definition/.test(v2Src), true)
  const v1Id = tuiSrc.match(/id:\s*"([^"]+)"/)?.[1]
  const v2Id = v2Src.match(/PLUGIN_ID\s*=\s*"([^"]+)"/)?.[1]
  check("v1 module id present", typeof v1Id, "string")
  check("v2 PLUGIN_ID present", typeof v2Id, "string")
  check("v1/v2 plugin ids match", v1Id, v2Id)
}

// --- v2 clock fan-in covers the whole v2 OpenCodeEvent union ---
// Same both-directions enforcement as the v1 SDK pin, but resolved through
// the V2Event union members (each member's first `type: "..."` literal).
// V2EventRpc is a template (`rpc.${string}`) — not subscribable, excluded.
{
  const { V2_EVENT_TYPES } = await import("../src/v2/events.ts")
  // @opencode/client is a transitive dep of @opencode/plugin: top-level when
  // hoisted, nested otherwise. Resolve whichever exists.
  const scriptsDir = dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))
  const v2ClientGen = ["@opencode", "client", "dist", "promise", "generated", "types.d.ts"]
  const topLevel = join(scriptsDir, "..", "node_modules", ...v2ClientGen)
  const nested = join(scriptsDir, "..", "node_modules", "@opencode", "plugin", "node_modules", ...v2ClientGen)
  const clientTypes = readFileSync(existsSync(topLevel) ? topLevel : nested, "utf8")
  const unionDecl = clientTypes.match(/export type V2Event = ([^;]+);/)
  const members = unionDecl ? unionDecl[1].split("|").map((s) => s.trim()).filter(Boolean) : []
  check("v2 union members found", members.length > 80, true)
  const busEvents = new Set()
  for (const name of members) {
    if (name === "V2EventRpc") continue // template literal type, not subscribable
    const idx = clientTypes.indexOf(`export type ${name} = {`)
    if (idx < 0) continue
    const m = clientTypes.slice(idx, idx + 3000).match(/\btype: "([^"]+)"/)
    if (m) busEvents.add(m[1])
  }
  const missing = [...busEvents].filter((t) => !V2_EVENT_TYPES.includes(t))
  const extra = V2_EVENT_TYPES.filter((t) => !busEvents.has(t))
  check("v2 watchdog covers every client event type", missing, [])
  check("v2 watchdog subscribes to real event types only", extra, [])
  check("v2 event tiers have no duplicates", new Set(V2_EVENT_TYPES).size, V2_EVENT_TYPES.length)
}

console.log(failures === 0 ? "\nAll sanity checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)
