import { createMemo } from "solid-js"
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { clockTick, ensureClockRunning, isClockStale, poke } from "./clock.ts"
import { DAY_LABELS, MS_MIN } from "./config.ts"
import {
  detectTimezone,
  formatDuration,
  formatMinutes,
  localMinutes,
  nextTransition,
  nextTransitionInRuns,
  statusForDate,
  statusForRuns,
  utcMinutes,
} from "./ranges.ts"
import type { DateTransition, PeakRun, StatusInfo } from "./ranges.ts"
import type { TimeRange } from "./types.ts"

// Re-exported for scripts/sanity-check.mjs (single source lives in clock.ts).
export { isClockStale, msUntilNextTick } from "./clock.ts"

// Shared display labels: the sidebar panel and the /dspeak settings header
// must render identical status text, so the formatting lives here (single
// source) instead of being duplicated per view.

/** City-only timezone label ("Asia/Damascus" -> "Damascus"). */
export function timezoneCity(tz: string): string {
  return tz.includes("/") ? tz.split("/").pop()!.replace(/_/g, " ") : tz
}

/**
 * "01:00" today, or "Mon 01:00" when the transition lands on another day.
 * Compare against the ticking clock (not a fresh Date) so the label stays
 * consistent with the displayed status even if a tick was missed.
 */
export function formatTransitionAt(t: DateTransition, now: Date): string {
  const clock = formatMinutes(utcMinutes(t.at))
  return t.at.toISOString().slice(0, 10) === now.toISOString().slice(0, 10) ? clock : `${DAY_LABELS[t.at.getUTCDay()]} ${clock}`
}

/** Minutes until the transition ("in 1h 23m" style). The scan aligns to whole minutes. */
export function formatTransitionIn(t: DateTransition, now: Date): string {
  return formatDuration(Math.round((t.at.getTime() - now.getTime()) / MS_MIN))
}

// Three-tone status color contract, shared by every status line (home dot,
// full panel, collapsed panel, /dspeak header) so they can never disagree.

/** Off-peak flips within this window render as "soon" (yellow). */
export const PEAK_SOON_MS = 30 * MS_MIN

export type StatusTone = "peak" | "soon" | "off-peak"

/**
 * Red-ish tone while peak, green when off-peak, yellow when off-peak but the
 * next flip is into peak and less than 30 minutes away.
 */
export function statusTone(peak: boolean, transition: DateTransition, now: Date): StatusTone {
  if (peak) return "peak"
  if (transition.to && transition.at.getTime() - now.getTime() < PEAK_SOON_MS) return "soon"
  return "off-peak"
}

/** Map a tone to its theme color: peak=error (red), soon=warning (yellow), off=success (green). */
export function toneColor(theme: TuiThemeCurrent, tone: StatusTone) {
  if (tone === "peak") return theme.error
  if (tone === "soon") return theme.warning
  return theme.success
}

// Reactive view state shared by the sidebar panel and the home-screen indicator.
export interface PeakStatus {
  now: () => Date // ticking clock (self-healing when stale)
  time: () => number // current UTC minutes
  status: () => StatusInfo // peak/off-peak at `now` (day-of-week aware)
  transition: () => DateTransition // next status change
  tz: string // detected IANA timezone
  local: () => number // current local minutes in tz
  /** True when the ticking clock was found stale (sleep, throttled timers). */
  stale: () => boolean
}

/**
 * Solid hook that recomputes the peak status whenever the shared clock ticks
 * or the configured windows change. Must be called inside a component.
 *
 * Robustness (fixes stale-data reports after long runs / PC sleep):
 * - all views read one process-wide clock (src/clock.ts): minute-aligned
 *   timeout for precision plus a self-sustaining fallback interval, so per-view
 *   timers can no longer diverge;
 * - the plugin fans every bus event into the shared clock (see tui.tsx), so
 *   views need no per-view subscriptions — they react to the clock signal
 *   automatically, and wake-from-sleep heals on first interaction;
 * - watchdog: any read that finds the clock older than CLOCK_WATCHDOG_MS
 *   returns a fresh Date immediately and schedules a heal, so even a dead
 *   timer self-heals on next render;
 * - hot status reads use the prebuilt coverage array when provided
 *   (binary search, sub-microsecond) instead of scanning every window.
 */
export function usePeakStatus(ranges: () => TimeRange[], runs?: () => PeakRun[]): PeakStatus {
  ensureClockRunning()

  // All derivations go through the staleness check so a dead timer still
  // renders fresh values on the next reactive pass. `stale` is a pure memo
  // over the clock signal, so it clears itself on the next refresh.
  const freshNow = (): Date => {
    const current = clockTick()
    if (isClockStale(current)) {
      // Timer died (sleep/throttle): render a fresh value now, heal async to
      // avoid writing a signal inside a memo computation.
      setTimeout(() => poke("stale-heal"), 0)
      return new Date()
    }
    return current
  }
  const stale = createMemo(() => isClockStale(clockTick()))
  const time = createMemo(() => utcMinutes(freshNow()))
  const status = createMemo(() => {
    const r = runs?.()
    if (r) return { peak: statusForRuns(r, freshNow()) }
    return statusForDate(freshNow(), ranges())
  })
  const transition = createMemo(() => {
    const r = runs?.()
    if (r) return nextTransitionInRuns(r, freshNow())
    return nextTransition(ranges(), freshNow())
  })
  const tz = detectTimezone()
  const local = createMemo(() => localMinutes(freshNow(), tz))

  return { now: freshNow, time, status, transition, tz, local, stale }
}
