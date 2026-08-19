import { createMemo, createSignal, onCleanup } from "solid-js"
import { detectTimezone, localMinutes, nextTransition, statusAt, utcMinutes } from "./ranges"
import type { StatusInfo, Transition } from "./ranges"
import type { TimeRange } from "./types"

// Reactive view state shared by the sidebar panel and the home-screen indicator.
export interface PeakStatus {
  time: () => number // current UTC minutes
  status: () => StatusInfo // peak/off-peak at `now`
  transition: () => Transition // next status change
  tz: string // detected IANA timezone
  local: () => number // current local minutes in tz
}

/**
 * Solid hook that recomputes the peak status whenever the clock ticks (every 30s)
 * or the configured ranges change. Must be called inside a component.
 */
export function usePeakStatus(ranges: () => TimeRange[]): PeakStatus {
  const [now, setNow] = createSignal(new Date())
  const timer = setInterval(() => setNow(new Date()), 30_000)
  onCleanup(() => clearInterval(timer))

  // Memos derive everything from `now`/`ranges`, so JSX that reads them stays reactive.
  const time = createMemo(() => utcMinutes(now()))
  const status = createMemo(() => statusAt(ranges(), time()))
  const transition = createMemo(() => nextTransition(ranges(), time()))
  const tz = detectTimezone()
  const local = createMemo(() => localMinutes(now(), tz))

  return { time, status, transition, tz, local }
}