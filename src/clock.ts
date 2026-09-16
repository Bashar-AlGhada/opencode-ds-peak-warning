import { createSignal, untrack } from "solid-js"
import { CLOCK_ALIGN_BUFFER_MS, CLOCK_EVENT_GATE_MS, CLOCK_WATCHDOG_MS, MS_MIN, TICK_MS } from "./config.ts"

// Process-wide singleton clock: the panel, the home indicator and the guard
// all read one signal, so per-view timers can no longer diverge. Drivers:
// minute-aligned timeout (precision) + self-sustaining fallback interval (a
// lost callback can't kill an interval) + tiered event fan-in via poke() +
// render-time staleness checks in usePeakStatus.

// Event tiers, fan-in only. The composition CLOCK_EVENT_TYPES must cover the
// ENTIRE Event["type"] union (enforced both directions by sanity-check.mjs
// against the SDK's generated types): any sign of life heals the clock, and
// the diagnostics row shows exactly which types are alive vs silent, so a
// dead bus is distinguishable from a dead timer. Hook names (e.g.
// "tool.execute.before") are NOT bus events — api.event.on would throw for
// them (caught per-type at subscribe time).
export const CLOCK_TIER_LIFECYCLE = [
  "session.created",
  "session.updated",
  "session.deleted",
  "session.diff",
  "session.error",
  "session.status",
  "session.idle",
  "session.compacted",
] as const

export const CLOCK_TIER_INTERACTION = [
  "tui.prompt.append",
  "tui.command.execute",
  "tui.session.select",
  "tui.toast.show",
] as const

export const CLOCK_TIER_GENERATION = [
  "message.updated",
  "message.removed",
  "message.part.updated",
  "message.part.removed",
  "message.part.delta",
  "session.next.prompted",
  "session.next.prompt.admitted",
  "session.next.step.started",
  "session.next.step.ended",
  "session.next.step.failed",
  "session.next.text.started",
  "session.next.text.delta",
  "session.next.text.ended",
  "session.next.reasoning.started",
  "session.next.reasoning.delta",
  "session.next.reasoning.ended",
  "session.next.tool.called",
  "session.next.tool.progress",
  "session.next.tool.success",
  "session.next.tool.failed",
  "session.next.tool.input.started",
  "session.next.tool.input.delta",
  "session.next.tool.input.ended",
  "session.next.retried",
  "session.next.compaction.started",
  "session.next.compaction.delta",
  "session.next.compaction.ended",
  "session.next.revert.staged",
  "session.next.revert.cleared",
  "session.next.revert.committed",
  "session.next.context.updated",
  "session.next.synthetic",
  "session.next.agent.switched",
  "session.next.model.switched",
  "session.next.moved",
  "session.next.shell.started",
  "session.next.shell.ended",
] as const

export const CLOCK_TIER_MISC = [
  "models-dev.refreshed",
  "integration.updated",
  "integration.connection.updated",
  "catalog.updated",
  "installation.updated",
  "installation.update-available",
  "file.edited",
  "reference.updated",
  "permission.asked",
  "permission.replied",
  "permission.v2.asked",
  "permission.v2.replied",
  "plugin.added",
  "project.directories.updated",
  "project.updated",
  "file.watcher.updated",
  "pty.created",
  "pty.updated",
  "pty.exited",
  "pty.deleted",
  "question.asked",
  "question.replied",
  "question.rejected",
  "question.v2.asked",
  "question.v2.replied",
  "question.v2.rejected",
  "todo.updated",
  "lsp.updated",
  "mcp.tools.changed",
  "mcp.browser.open.failed",
  "command.executed",
  "vcs.branch.updated",
  "workspace.ready",
  "workspace.failed",
  "workspace.status",
  "worktree.ready",
  "worktree.failed",
  "server.connected",
  "global.disposed",
  "server.instance.disposed",
] as const

/** Every subscribed bus event, tier order preserved (for diagnostics display). */
export const CLOCK_EVENT_TYPES: readonly string[] = [
  ...CLOCK_TIER_LIFECYCLE,
  ...CLOCK_TIER_INTERACTION,
  ...CLOCK_TIER_GENERATION,
  ...CLOCK_TIER_MISC,
]

/** ms until the next minute boundary (+ buffer so transitions have settled). */
export function msUntilNextTick(from: number = Date.now()): number {
  const remain = MS_MIN - (from % MS_MIN)
  return remain + CLOCK_ALIGN_BUFFER_MS
}

/** True when a ticking `now` value is too old (sleep, throttled timers). */
export function isClockStale(now: Date, at: number = Date.now()): boolean {
  return at - now.getTime() > CLOCK_WATCHDOG_MS
}

/** Pure gate: true when a refresh is due (also rate-limits poke storms). */
export function gateAllows(lastRefreshAt: number, at: number): boolean {
  return at - lastRefreshAt >= CLOCK_EVENT_GATE_MS
}

export interface ClockDiagnostics {
  /** Current clock value (ms since epoch). */
  now: number
  /** When the clock last refreshed (ms since epoch). */
  lastTickAt: number
  /** Timer-driven ticks since start. */
  tickCount: number
  /** All refreshes (timer + gated events + manual). */
  refreshCount: number
  /** Reception count per event type (proves delivery, including zeros). */
  eventCounts: Record<string, number>
  started: boolean
}

// Module state: created once per process, never disposed.
const [now, setNow] = createSignal(new Date())
const [tickCount, setTickCount] = createSignal(0)
const [refreshCount, setRefreshCount] = createSignal(0)
let lastTickAt = Date.now()
let lastRefreshAt = 0
let started = false
let minuteTimer: ReturnType<typeof setTimeout> | undefined
let fallbackTimer: ReturnType<typeof setInterval> | undefined
const eventCounts: Record<string, number> = {}
for (const t of CLOCK_EVENT_TYPES) eventCounts[t] = 0

/** Refresh the clock value (records both tick and refresh counters). */
export function refreshClock(fromTimer = false): void {
  const at = Date.now()
  lastTickAt = at
  lastRefreshAt = at
  setNow(new Date(at))
  setRefreshCount((c) => c + 1)
  if (fromTimer) setTickCount((c) => c + 1)
}

function scheduleMinute(): void {
  if (!started) return
  if (minuteTimer !== undefined) clearTimeout(minuteTimer)
  minuteTimer = setTimeout(() => {
    refreshClock(true)
    scheduleMinute()
  }, msUntilNextTick())
  try {
    ;(minuteTimer as unknown as { unref?: () => void }).unref?.()
  } catch {
    // unref unavailable on this runtime; cleared on reset regardless
  }
}

/** Start the drivers (idempotent). Safe to call from every view. */
export function ensureClockRunning(): void {
  if (started) return
  started = true
  refreshClock(true)
  scheduleMinute()
  fallbackTimer = setInterval(() => {
    refreshClock(true)
    scheduleMinute() // re-arm the minute chain in case its callback was lost
  }, TICK_MS)
  try {
    ;(fallbackTimer as unknown as { unref?: () => void }).unref?.()
  } catch {
    // unref unavailable on this runtime; cleared on reset regardless
  }
}

/**
 * Nanosecond event fan-in: one Date.now, one comparison, one counter bump,
 * zero signal writes while inside the gate window.
 */
export function poke(source = "external"): void {
  try {
    eventCounts[source] = (eventCounts[source] ?? 0) + 1
  } catch {
    // counter bookkeeping must never break the clock
  }
  const at = Date.now()
  if (gateAllows(lastRefreshAt, at)) refreshClock()
}

/** Reactive read of the clock value (tracks, for memos/components). */
export function clockTick(): Date {
  return now()
}

/** Plain snapshot for the /dspeak diagnostics row (no reactive tracking). */
export function clockDiagnostics(): ClockDiagnostics {
  return untrack(() => ({
    now: now().getTime(),
    lastTickAt,
    tickCount: tickCount(),
    refreshCount: refreshCount(),
    eventCounts: { ...eventCounts },
    started,
  }))
}

/** Test-only reset: stops drivers and clears counters. */
export function resetClockForTests(): void {
  started = false
  if (minuteTimer !== undefined) {
    try {
      clearTimeout(minuteTimer)
    } catch {
      // ignore cleanup errors
    }
    minuteTimer = undefined
  }
  if (fallbackTimer !== undefined) {
    try {
      clearInterval(fallbackTimer)
    } catch {
      // ignore cleanup errors
    }
    fallbackTimer = undefined
  }
  lastTickAt = Date.now()
  lastRefreshAt = 0
  setNow(new Date())
  setTickCount(0)
  setRefreshCount(0)
  for (const k of Object.keys(eventCounts)) delete eventCounts[k]
  for (const t of CLOCK_EVENT_TYPES) eventCounts[t] = 0
}
