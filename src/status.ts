import { createMemo, createSignal, onCleanup } from "solid-js"
import { TICK_MS } from "./config.ts"
import { detectTimezone, localMinutes, nextTransition, statusForDate, utcMinutes } from "./ranges.ts"
import type { DateTransition, StatusInfo } from "./ranges.ts"
import type { TimeRange } from "./types.ts"

// Reactive view state shared by the sidebar panel and the home-screen indicator.
export interface PeakStatus {
  now: () => Date // ticking clock
  time: () => number // current UTC minutes
  status: () => StatusInfo // peak/off-peak at `now` (day-of-week aware)
  transition: () => DateTransition // next status change
  tz: string // detected IANA timezone
  local: () => number // current local minutes in tz
}

/**
 * Solid hook that recomputes the peak status whenever the clock ticks (every 30s)
 * or the configured windows change. Must be called inside a component.
 */
export function usePeakStatus(ranges: () => TimeRange[]): PeakStatus {
  const [now, setNow] = createSignal(new Date())
  const timer = setInterval(() => setNow(new Date()), TICK_MS)
  onCleanup(() => clearInterval(timer))

  // Memos derive everything from `now`/`ranges`, so JSX that reads them stays reactive.
  const time = createMemo(() => utcMinutes(now()))
  const status = createMemo(() => statusForDate(now(), ranges()))
  const transition = createMemo(() => nextTransition(ranges(), now()))
  const tz = detectTimezone()
  const local = createMemo(() => localMinutes(now(), tz))

  return { now, time, status, transition, tz, local }
}