import type { TimeRange } from "./types.ts"

// Central configuration: every global constant lives here so behavior can be
// tuned in one place instead of being scattered across modules.

// --- Time units ---
export const MS_MIN = 60_000
export const MS_DAY = 86_400_000

// --- Beijing Time ---
// DeepSeek bills by the Beijing calendar day; Beijing is fixed UTC+8 (no DST),
// so shifting a timestamp by this offset makes UTC weekday math exact.
export const BEIJING_OFFSET_MS = 8 * 3600_000

// --- Day-of-week helpers ---
// Names indexed by day number (0 = Sun), matching getUTCDay() conventions.
export const WEEKDAYS: readonly string[] = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

// Short display labels indexed by day number (0 = Sun).
export const DAY_LABELS: string[] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]

/** Weekdays (Mon-Fri) DeepSeek's current peak windows apply to. */
export const WEEKDAY_DEFAULT_DAYS: number[] = [1, 2, 3, 4, 5]

/** DeepSeek's documented peak windows (UTC), Monday-Friday only. */
export const DEFAULT_RANGES: TimeRange[] = [
  { start: "01:00", end: "04:00", days: [...WEEKDAY_DEFAULT_DAYS] },
  { start: "06:00", end: "10:00", days: [...WEEKDAY_DEFAULT_DAYS] },
]

// --- Plugin behavior ---
/** KV key where /dspeak-edited windows are persisted. */
export const KV_RANGES_KEY = "ds-peak:ranges"

/** Default sidebar slot order (slots render lowest-first). */
export const DEFAULT_SLOT_ORDER = 150

/** How often the clock signal ticks and status views re-render. */
export const TICK_MS = 30_000

/** How many days ahead the transition scanner looks (covers any weekly gap). */
export const TRANSITION_SCAN_DAYS = 8