import type { TimeRange } from "./types"

// DeepSeek's documented peak windows (UTC): 01:00-04:00 and 06:00-10:00.
export const DEFAULT_RANGES: TimeRange[] = [
  { start: "01:00", end: "04:00" },
  { start: "06:00", end: "10:00" },
]

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

/** Current status at a given time: peak if inside any window, otherwise off-peak. */
export function statusAt(ranges: TimeRange[], time: number): StatusInfo {
  const t = ((time % 1440) + 1440) % 1440
  for (const range of ranges) {
    if (contains(t, range)) return { peak: true, range }
  }
  return { peak: false }
}

export interface Transition {
  at: number
  /** True when the transition enters a peak window (peak -> off-peak transitions are false). */
  to: boolean
}

/** Next status change within the next 24h, scanning minute-by-minute. */
export function nextTransition(ranges: TimeRange[], time: number): Transition {
  for (let t = time + 1; t < time + 24 * 60; t++) {
    const cur = statusAt(ranges, t - 1).peak
    const next = statusAt(ranges, t).peak
    if (cur !== next) return { at: t % (24 * 60), to: next }
  }
  return { at: (time + 1) % (24 * 60), to: statusAt(ranges, time).peak }
}

export interface NextOccurrence {
  /** Whether the range is currently active (now is inside the range). */
  active: boolean
  /** Minutes until the range next starts (1-1439 when not active, 0 when active). */
  minutes: number
}

/** Time until a window's next start; "active" when now is already inside it. */
export function minutesUntilStart(range: TimeRange, time: number): NextOccurrence {
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

/** Coerce an untrusted list (e.g. from KV/options) into valid TimeRanges, dropping bad entries. */
export function sanitizeRanges(list: unknown[]): TimeRange[] {
  const out: TimeRange[] = []
  for (const item of list) {
    if (!item || typeof item !== "object") continue
    const r = item as Record<string, unknown>
    if (typeof r.start !== "string" || typeof r.end !== "string") continue
    try {
      toMinutes(r.start)
      toMinutes(r.end)
    } catch {
      continue
    }
    out.push({ start: r.start, end: r.end })
  }
  return out
}

/** Parse user input like "22:00-02:00" (hyphen, en/em dash ok) into a range, or null if invalid. */
export function parseRange(input: string): TimeRange | null {
  const s = input.trim()
  if (!s) return null
  const tm = s.split(/[-–—]/)
  if (tm.length !== 2) return null
  const start = tm[0].trim()
  const end = tm[1].trim()
  try {
    toMinutes(start)
    toMinutes(end)
  } catch {
    return null
  }
  return { start, end }
}