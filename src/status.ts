import { createMemo, createSignal, onCleanup } from "solid-js"
import { CLOCK_ALIGN_BUFFER_MS, CLOCK_WATCHDOG_MS, MS_MIN } from "./config.ts"
import { detectTimezone, localMinutes, nextTransition, statusForDate, utcMinutes } from "./ranges.ts"
import type { DateTransition, StatusInfo } from "./ranges.ts"
import type { TimeRange } from "./types.ts"

// Reactive view state shared by the sidebar panel and the home-screen indicator.
export interface PeakStatus {
  now: () => Date // ticking clock (self-healing when stale)
  time: () => number // current UTC minutes
  status: () => StatusInfo // peak/off-peak at `now` (day-of-week aware)
  transition: () => DateTransition // next status change
  tz: string // detected IANA timezone
  local: () => number // current local minutes in tz
  /** True when the ticking clock was found stale and forced fresh. */
  stale: () => boolean
}

/** Extra refresh triggers (TUI event subscriptions). All optional. */
export interface PeakClockEvents {
  /** Subscribe to activity; return an unsubscribe fn. Errors are ignored. */
  subscribe?: (cb: () => void) => () => void
}

/** ms until the next minute boundary (+ buffer so transitions have settled). */
export function msUntilNextTick(from: number = Date.now()): number {
  const remain = MS_MIN - (from % MS_MIN)
  return remain + CLOCK_ALIGN_BUFFER_MS
}

/** True when a ticking `now` value is too old (sleep, throttled timers). */
export function isClockStale(now: Date, at: number = Date.now()): boolean {
  return at - now.getTime() > CLOCK_WATCHDOG_MS
}

/**
 * Solid hook that recomputes the peak status whenever the clock ticks or the
 * configured windows change. Must be called inside a component.
 *
 * Robustness (fixes stale-data reports after long runs / PC sleep):
 * - chained timeout aligned to the next minute boundary instead of a fixed
 *   30s interval, so status flips within ~1s of a window edge;
 * - watchdog: any read that finds `now` older than CLOCK_WATCHDOG_MS forces
 *   an immediate refresh, so even a dead timer self-heals on next render;
 * - optional event subscription (session/activity events) refreshes the clock
 *   on user activity, covering wake-from-sleep without waiting for the timer.
 */
export function usePeakStatus(ranges: () => TimeRange[], events?: PeakClockEvents): PeakStatus {
  const [now, setNow] = createSignal(new Date())
  const [stale, setStale] = createSignal(false)
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const refresh = () => {
    if (disposed) return
    setStale(false)
    setNow(new Date())
  }

  const refreshIfStale = (): Date => {
    const current = now()
    if (isClockStale(current)) {
      // Timer died (sleep/throttle). Mark stale so UI can hint, then refresh
      // async to avoid writing a signal inside a memo computation.
      setStale(true)
      setTimeout(refresh, 0)
      return new Date()
    }
    return current
  }

  const schedule = () => {
    if (disposed) return
    if (timer !== undefined) clearTimeout(timer)
    timer = setTimeout(() => {
      refresh()
      schedule()
    }, msUntilNextTick())
  }
  schedule()

  let unsubscribe: (() => void) | undefined
  try {
    unsubscribe = events?.subscribe?.(refresh)
  } catch {
    unsubscribe = undefined
  }

  onCleanup(() => {
    disposed = true
    if (timer !== undefined) clearTimeout(timer)
    try {
      unsubscribe?.()
    } catch {
      // ignore cleanup errors
    }
  })

  // All derivations go through the staleness check so a dead timer still
  // renders fresh values on the next reactive pass.
  const freshNow = () => refreshIfStale()
  const time = createMemo(() => utcMinutes(freshNow()))
  const status = createMemo(() => statusForDate(freshNow(), ranges()))
  const transition = createMemo(() => nextTransition(ranges(), freshNow()))
  const tz = detectTimezone()
  const local = createMemo(() => localMinutes(freshNow(), tz))

  return { now: freshNow, time, status, transition, tz, local, stale }
}
