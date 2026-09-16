import type { TimeRange } from "./types.ts"
import { BEIJING_OFFSET_MS, MS_DAY, MS_MIN, TRANSITION_SCAN_DAYS, WEEKDAYS } from "./config.ts"

// Time domains (three clocks, never mixed):
// - Window edges (`start`/`end`) are UTC wall-clock minutes. All status math
//   runs on UTC: contains(), utcMinutes(), and the panel countdowns.
// - `days` patterns are Beijing-calendar weekdays (DeepSeek bills by them).
//   Beijing is fixed UTC+8 (no DST), so the day flips exactly at 16:00 UTC —
//   a window can die mid-UTC-span at that boundary (see beijingDayOfWeek).
// - The user's local timezone is DISPLAY ONLY (localMinutes, panel "UTC x ·
//   y City" line). It never influences peak status or transitions.
// The merged coverage array unifies the first two: Beijing-week minutes
// (dow * 1440 + Beijing clock), where every edge stays minute-aligned.

// Matches "HH:MM" with optional single-digit hours (e.g. "1:30").
const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/

/** Parse "HH:MM" into minutes since midnight (throws on invalid input). */
export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm)
  if (!m) throw new Error(`Invalid time "${hhmm}", expected HH:MM`)
  return Number(m[1]) * 60 + Number(m[2])
}

/** Format a minute-of-day value as "HH:MM", wrapping negatives/overshoot into 0-1439. */
export function formatMinutes(min: number): string {
  const m = ((min % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`
}

/** Detect the current IANA timezone, falling back to UTC. */
export function detectTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  } catch {
    return "UTC"
  }
}

/** Current UTC clock as minutes since midnight. */
export function utcMinutes(date: Date): number {
  return date.getUTCHours() * 60 + date.getUTCMinutes()
}

/** Current clock in a given IANA timezone as minutes since midnight. */
export function localMinutes(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date)
    let h = 0
    let m = 0
    for (const part of parts) {
      if (part.type === "hour") h = Number(part.value)
      else if (part.type === "minute") m = Number(part.value)
    }
    return h * 60 + m
  } catch {
    return utcMinutes(date)
  }
}

/**
 * Day of week in Beijing Time (0 = Sunday ... 6 = Saturday).
 * Beijing is fixed UTC+8 (no DST), so shifting by the offset and reading the
 * UTC weekday is exact — no Intl needed.
 */
export function beijingDayOfWeek(date: Date): number {
  const beijingDays = Math.floor((date.getTime() + BEIJING_OFFSET_MS) / MS_DAY)
  return (((beijingDays + 4) % 7) + 7) % 7 // epoch day 0 (1970-01-01) was a Thursday
}

/** True when the window applies on the given Beijing weekday (no days = every day). */
export function appliesOnDay(range: TimeRange, day: number): boolean {
  return !range.days || range.days.includes(day)
}

/** True when `time` falls inside the range (start inclusive, end exclusive, midnight-wrapped). */
export function contains(time: number, range: TimeRange): boolean {
  const s = toMinutes(range.start)
  const e = toMinutes(range.end)
  if (s === e) return true // zero-length range means "all day"
  if (s < e) return time >= s && time < e
  return time >= s || time < e // wraps past midnight (e.g. 22:00-02:00)
}

export interface StatusInfo {
  peak: boolean
  range?: TimeRange
}

/** Pure time-of-day check against a window list (no weekday filter). */
export function statusAt(ranges: TimeRange[], time: number): StatusInfo {
  const t = ((time % 1440) + 1440) % 1440
  for (const range of ranges) {
    if (contains(t, range)) return { peak: true, range }
  }
  return { peak: false }
}

/** Full status at a real moment: both the UTC clock and the Beijing weekday must match. */
export function statusForDate(date: Date, ranges: TimeRange[]): StatusInfo {
  const t = utcMinutes(date)
  const day = beijingDayOfWeek(date)
  for (const range of ranges) {
    if (appliesOnDay(range, day) && contains(t, range)) return { peak: true, range }
  }
  return { peak: false }
}

export interface DateTransition {
  at: Date
  /** True when the transition enters a peak window. */
  to: boolean
}

/** Next peak/off-peak flip after a real moment, honoring each window's day pattern. */
export function nextTransition(ranges: TimeRange[], date: Date): DateTransition {
  const cur = statusForDate(date, ranges).peak
  const start = Math.floor(date.getTime() / MS_MIN) * MS_MIN // align to whole minutes
  const end = start + TRANSITION_SCAN_DAYS * MS_DAY
  for (let t = start + MS_MIN; t <= end; t += MS_MIN) {
    if (statusForDate(new Date(t), ranges).peak !== cur) {
      return { at: new Date(t), to: !cur }
    }
  }
  // No flip within the horizon (e.g. no windows at all): stay on current status.
  return { at: new Date(start + MS_MIN), to: cur }
}

export interface NextOccurrence {
  /** Inside the window right now (and it applies today). */
  active: boolean
  /** Minutes until the next start across days (0 when active). */
  minutes: number
  /** Beijing-day distance to that next start (0 = today). */
  daysAway: number
}

/** Next moment this window actually charges peak, following its day pattern. */
export function nextOccurrence(range: TimeRange, date: Date): NextOccurrence {
  const nowMin = ((utcMinutes(date) % 1440) + 1440) % 1440
  const today = beijingDayOfWeek(date)
  if (appliesOnDay(range, today) && contains(nowMin, range)) {
    return { active: true, minutes: 0, daysAway: 0 }
  }
  const start = Math.floor(date.getTime() / MS_MIN) * MS_MIN // align to whole minutes
  const end = start + TRANSITION_SCAN_DAYS * MS_DAY
  for (let ts = start + MS_MIN; ts <= end; ts += MS_MIN) {
    const d = new Date(ts)
    if (appliesOnDay(range, beijingDayOfWeek(d)) && contains(utcMinutes(d), range)) {
      return {
        active: false,
        minutes: Math.round((ts - date.getTime()) / MS_MIN),
        daysAway: (beijingDayOfWeek(d) - today + 7) % 7,
      }
    }
  }
  // Unreachable for valid weekly patterns; report a full week out.
  return { active: false, minutes: 7 * 1440, daysAway: 7 }
}

/** Pure time-of-day countdown to a window's next start ("active" when inside it). */
export function minutesUntilStart(range: TimeRange, time: number): { active: boolean; minutes: number } {
  const t = ((time % 1440) + 1440) % 1440
  if (contains(t, range)) return { active: true, minutes: 0 }
  const s = toMinutes(range.start)
  const delta = (s - t + 1440) % 1440
  return { active: false, minutes: delta === 0 ? 1440 : delta }
}

/** Format minutes as a compact duration like "5h 20m", "2h", or "45m". */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const rem = m % 60
  if (h > 0 && rem > 0) return `${h}h ${rem}m`
  if (h > 0) return `${h}h`
  return `${rem}m`
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/** Compact day-pattern label like "Mon-Fri" or "Sun,Sat"; "" when it applies every day. */
export function formatDays(days?: number[]): string {
  if (!days || days.length === 0 || days.length >= 7) return ""
  const sorted = [...days].sort((a, b) => a - b)
  const parts: string[] = []
  let i = 0
  while (i < sorted.length) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    if (j - i >= 2) parts.push(`${cap(WEEKDAYS[sorted[i]])}-${cap(WEEKDAYS[sorted[j]])}`)
    else for (let k = i; k <= j; k++) parts.push(cap(WEEKDAYS[sorted[k]]))
    i = j + 1
  }
  return parts.join(",")
}

// Day token: a 3-letter code, optionally ranged like "mon-fri".
const DAY_TOKEN = /^(sun|mon|tue|wed|thu|fri|sat)(-(sun|mon|tue|wed|thu|fri|sat))?$/

function parseDayToken(token: string): number[] | null {
  const m = DAY_TOKEN.exec(token)
  if (!m) return null
  const a = WEEKDAYS.indexOf(m[1])
  if (!m[2]) return [a]
  const b = WEEKDAYS.indexOf(m[3])
  if (b < a) return null // reversed or wrapping ranges are rejected
  const out: number[] = []
  for (let i = a; i <= b; i++) out.push(i)
  return out
}

/**
 * Parse user input into a window. Times are required ("22:00-02:00", en/em
 * dashes ok); an optional trailing day pattern restricts weekdays, e.g.
 * "06:00-10:00 Mon-Fri", "14:00-16:00 sat,sun", "20:00-21:00 Wed". Days refer
 * to the Beijing calendar day. Returns null on invalid input.
 */
export function parseRange(input: string): TimeRange | null {
  const norm = input.trim().toLowerCase().replace(/[–—]/g, "-").replace(/,/g, " ")
  if (!norm) return null
  const tokens = norm.split(/\s+/)
  const daySet = new Set<number>()
  // Trailing tokens that look like day specs form the weekday pattern.
  while (tokens.length > 1 && DAY_TOKEN.test(tokens[tokens.length - 1])) {
    const got = parseDayToken(tokens.pop() as string)
    if (!got) return null
    for (const d of got) daySet.add(d)
  }
  const timeSpec = tokens.join("").replace(/\s*-\s*/g, "-")
  const tm = timeSpec.split("-")
  if (tm.length !== 2) return null
  try {
    toMinutes(tm[0])
    toMinutes(tm[1])
  } catch {
    return null
  }
  const out: TimeRange = { start: tm[0], end: tm[1] }
  if (daySet.size > 0) out.days = [...daySet].sort((a, b) => a - b)
  return out
}

/** Coerce an untrusted list (e.g. from KV/options) into valid windows, dropping bad entries. */
export function sanitizeRanges(list: unknown[]): TimeRange[] {
  const out: TimeRange[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (typeof r.start !== "string" || typeof r.end !== "string") continue
    let days: number[] | undefined
    if (r.days !== undefined) {
      if (!Array.isArray(r.days)) continue
      days = [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort((a, b) => a - b)
      if (days.length === 0) continue
    }
    try {
      toMinutes(r.start)
      toMinutes(r.end)
    } catch {
      continue
    }
    out.push(days ? { start: r.start, end: r.end, days } : { start: r.start, end: r.end })
  }
  return out
}
/** Attach `defaultDays` to legacy windows that predate day patterns. */
export function migrateLegacyRanges(list: TimeRange[], defaultDays: number[]): TimeRange[] {
  return list.map((r) => (r.days ? r : { ...r, days: [...defaultDays] }))
}

// --- Merged coverage array (built at write time, read on every tick) ---
//
// Overlapping windows are legitimate (an every-day window plus a Thursday-only
// window must both fire on Thursday), so settings keep them as entered. The
// hot path instead reads this derived structure: the union of all windows as
// sorted disjoint runs of Beijing-week minutes. Built once per settings
// change (~10k cheap evals), read per tick via binary search.

/** Minutes in a Beijing week (7 x 1440). */
export const MINUTES_PER_WEEK = 7 * 1440

/** One disjoint peak run: Beijing-week minutes in [start, end). */
export interface PeakRun {
  start: number
  end: number
}

/**
 * Beijing-week minute for a real moment: weekday * 1440 + Beijing clock
 * minutes. Uses the same fixed-offset math as beijingDayOfWeek, so it agrees
 * with statusForDate exactly at minute precision.
 */
export function beijingWeekMinute(date: Date): number {
  const shifted = date.getTime() + BEIJING_OFFSET_MS
  const dow = (((Math.floor(shifted / MS_DAY) + 4) % 7) + 7) % 7
  const dayMs = ((shifted % MS_DAY) + MS_DAY) % MS_DAY
  return dow * 1440 + Math.floor(dayMs / MS_MIN)
}

/**
 * Merge windows into sorted disjoint peak runs (union semantics: a minute is
 * peak when ANY window covers it). Adjacent runs merge; week-edge wraps stay
 * split as [0, a) + [b, 10080) and readers wrap around them.
 */
export function buildCoverageRuns(ranges: TimeRange[]): PeakRun[] {
  if (!ranges.length) return []
  const spans: Array<{ s: number; e: number; days: number[]; allDay: boolean }> = []
  for (const r of ranges) {
    const s = toMinutes(r.start)
    const e = toMinutes(r.end)
    spans.push({ s, e, days: r.days && r.days.length ? r.days : [0, 1, 2, 3, 4, 5, 6], allDay: s === e })
  }
  const isPeak = (dow: number, utcMin: number): boolean => {
    for (const sp of spans) {
      if (!sp.days.includes(dow)) continue
      if (sp.allDay) return true
      if (sp.s < sp.e ? utcMin >= sp.s && utcMin < sp.e : utcMin >= sp.s || utcMin < sp.e) return true
    }
    return false
  }
  const runs: PeakRun[] = []
  let open = -1
  for (let w = 0; w <= MINUTES_PER_WEEK; w++) {
    let peak = false
    if (w < MINUTES_PER_WEEK) {
      const dow = Math.floor(w / 1440)
      const utcMin = (((w % 1440) - 480) % 1440 + 1440) % 1440 // Beijing clock - 8h
      peak = isPeak(dow, utcMin)
    }
    if (peak && open < 0) open = w
    else if (!peak && open >= 0) {
      runs.push({ start: open, end: w })
      open = -1
    }
  }
  return runs
}

/** True when a Beijing-week minute falls inside any run (binary search). */
export function statusInRuns(runs: PeakRun[], weekMinute: number): boolean {
  let lo = 0
  let hi = runs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    const r = runs[mid]
    if (weekMinute < r.start) hi = mid - 1
    else if (weekMinute >= r.end) lo = mid + 1
    else return true
  }
  return false
}

/** Peak check at a real moment via the coverage array (reference: statusForDate). */
export function statusForRuns(runs: PeakRun[], date: Date): boolean {
  return statusInRuns(runs, beijingWeekMinute(date))
}

/**
 * Next peak/off-peak flip after a real moment via the coverage array.
 * Matches nextTransition exactly, including the no-flip fallback
 * (`to: current`, at next minute) for empty and full-week coverage.
 */
export function nextTransitionInRuns(runs: PeakRun[], date: Date): DateTransition {
  const start = Math.floor(date.getTime() / MS_MIN) * MS_MIN // align to whole minutes
  const w = beijingWeekMinute(new Date(start))
  const cur = statusInRuns(runs, w)
  if (!runs.length || (runs.length === 1 && runs[0].start === 0 && runs[0].end === MINUTES_PER_WEEK)) {
    return { at: new Date(start + MS_MIN), to: cur }
  }
  let delta: number
  if (cur) {
    // Inside a run: the flip is its exclusive end.
    let lo = 0
    let hi = runs.length - 1
    let end = -1
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      const r = runs[mid]
      if (w < r.start) hi = mid - 1
      else if (w >= r.end) lo = mid + 1
      else {
        end = r.end
        break
      }
    }
    delta = end < 0 ? MINUTES_PER_WEEK : end - w // unreachable fallback: full week out
  } else {
    // Off-peak: the flip is the next run start (wrapping past week edge).
    let next = -1
    for (const r of runs) {
      if (r.start > w) {
        next = r.start
        break
      }
    }
    if (next < 0) next = runs[0].start + MINUTES_PER_WEEK
    delta = next - w
  }
  if (delta <= 0) delta = MINUTES_PER_WEEK // defensive; unreachable by construction
  return { at: new Date(start + delta * MS_MIN), to: !cur }
}

/**
 * Stable fingerprint of the EFFECTIVE ranges (post sanitize/migrate). Stored
 * alongside the derived runs so any out-of-band KV edit is detected and the
 * array is rebuilt instead of trusted.
 */
export function coverageFingerprint(ranges: TimeRange[]): string {
  return JSON.stringify(ranges.map((r) => [r.start, r.end, r.days ? [...r.days].sort((a, b) => a - b) : 0]))
}

/** Persisted coverage document: source ranges + derived runs + fingerprint. */
export interface CoverageDoc {
  v: 1
  ranges: TimeRange[]
  runs: PeakRun[]
  fingerprint: string
}

/** Build a coverage document from effective ranges (deep-copies the ranges). */
export function makeCoverageDoc(ranges: TimeRange[]): CoverageDoc {
  const copy = ranges.map((r) => ({ ...r, days: r.days ? [...r.days] : undefined }))
  return { v: 1, ranges: copy, runs: buildCoverageRuns(copy), fingerprint: coverageFingerprint(copy) }
}

function isValidRun(r: unknown): r is PeakRun {
  if (!r || typeof r !== "object") return false
  const { start, end } = r as Record<string, unknown>
  return (
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    (start as number) >= 0 &&
    (end as number) <= MINUTES_PER_WEEK &&
    (start as number) < (end as number)
  )
}

/**
 * Coerce an untrusted KV value into a coverage document. Returns null for
 * legacy plain-array saves, tampered runs, and fingerprint mismatches —
 * callers rebuild from the source ranges in all those cases.
 */
export function coerceCoverageDoc(raw: unknown): CoverageDoc | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const d = raw as Record<string, unknown>
  if (d.v !== 1 || typeof d.fingerprint !== "string" || !Array.isArray(d.ranges) || !Array.isArray(d.runs)) {
    return null
  }
  const ranges = sanitizeRanges(d.ranges)
  if (coverageFingerprint(ranges) !== d.fingerprint) return null
  const runs = (d.runs as unknown[]).filter(isValidRun)
  if (runs.length !== (d.runs as unknown[]).length) return null
  const sorted = [...runs].sort((a, b) => a.start - b.start || a.end - b.end)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].start < sorted[i - 1].end) return null // overlapping/unsorted: don't trust
  }
  return { v: 1, ranges, runs: sorted, fingerprint: d.fingerprint }
}

/** True when the document's runs were built from exactly these ranges. */
export function isCoverageFresh(doc: CoverageDoc, ranges: TimeRange[]): boolean {
  return doc.fingerprint === coverageFingerprint(ranges)
}
