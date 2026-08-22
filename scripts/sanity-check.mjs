import { DEFAULT_RANGES } from "../src/config.ts"
import {
  appliesOnDay,
  beijingDayOfWeek,
  contains,
  formatDays,
  formatDuration,
  formatMinutes,
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

console.log(failures === 0 ? "\nAll sanity checks passed." : `\n${failures} check(s) failed.`)
process.exit(failures === 0 ? 0 : 1)