import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { buildCoverageRuns, formatDuration, formatMinutes, utcMinutes } from "./ranges.ts"
import { nextTransition, nextTransitionInRuns, statusForDate, statusForRuns } from "./ranges.ts"
import type { PeakRun } from "./ranges.ts"
import { shouldGuard } from "./guard.ts"
import type { GuardSettings, TimeRange } from "./types.ts"

// Intercepts `client.session.prompt` / `promptAsync` so peak confirmation
// happens before the message is sent.
//
// Why patch the client instead of replacing the prompt slot:
// - `Prompt.onSubmit` / slot `on_submit` fire AFTER the message is sent, so
//   they cannot block. The only pre-send gate on the stock Prompt is the
//   `disabled` prop, but that also blocks typing and every slash command
//   (/sessions, /models, /dspeak, even the confirm command itself) — a
//   deadlock, especially with cooldown 0.
// - Slash commands, shell mode, session switching and settings never flow
//   through `session.prompt`, so wrapping just that method (plus
//   `promptAsync`) structurally cannot deadlock them, and typing is untouched.

export interface PromptModel {
  providerID?: string
  modelID?: string
}

export type GuardOutcome = "pass" | "warned" | "sent" | "cancelled" | "blocked" | "error"

export interface GuardActivity {
  at: number
  outcome: GuardOutcome
  reason: string
}

export interface PromptGuardDeps {
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; the confirm summary uses it when provided. */
  runs?: () => PeakRun[]
  settings: () => GuardSettings
  lastAck: () => number
  ack: (at?: number) => void
  /** Show the confirm dialog; resolves true when the user confirms. */
  showConfirm: (summary: string) => Promise<boolean>
  /** Observe every intercepted call (drives the sidebar status line). */
  notify: (activity: GuardActivity) => void
  toast: (message: string, variant?: "info" | "success" | "warning" | "error") => void
  getSessionModel: (sessionID: string) => PromptModel
  getDefaultModel: () => PromptModel
  /** Called whenever the installed state may have changed. */
  onState?: (installed: boolean) => void
}

export interface PromptGuardHandle {
  installed: boolean
  /** Machine-readable install state ("ok" or a failure reason). */
  reason: string
  isInstalled: () => boolean
  ensurePatched: () => void
  uninstall: () => void
}

const MARK = "__dsPeakGuard"
const GUARD_REJECTION = "__dsPeakGuardReject"
const REPATCH_MS = 15_000

export function guardError(message: string): Error {
  const err = new Error(message) as Error & Record<string, boolean>
  err[GUARD_REJECTION] = true
  return err
}

/** First-wins settlement for the confirm dialog promise. */
export interface ConfirmSettlement {
  done: (confirmed: boolean) => void
  promise: Promise<boolean>
}

export function createConfirmSettlement(): ConfirmSettlement {
  let settled = false
  let resolve!: (confirmed: boolean) => void
  const promise = new Promise<boolean>((r) => {
    resolve = r
  })
  return {
    done: (confirmed: boolean) => {
      if (!settled) {
        settled = true
        resolve(confirmed)
      }
    },
    promise,
  }
}

export interface ConfirmDialogCallbacks {
  onConfirm: () => void
  onCancel: () => void
  onClose: () => void
}

/**
 * Dialog button handlers with settle-first ordering. The host fires `onClose`
 * when the dialog is cleared, so resolving AFTER `dialog.clear()` lets the
 * close handler win the first-wins settlement and every confirm resolves as
 * cancel. Settling first makes the outcome deterministic regardless of
 * whether the host fires onClose synchronously or asynchronously.
 */
export function confirmDialogCallbacks(
  api: Pick<TuiPluginApi, "ui">,
  settle: ConfirmSettlement,
): ConfirmDialogCallbacks {
  const clear = () => {
    try {
      api.ui.dialog.clear()
    } catch {
      // ignore dialog errors; the promise is already settled
    }
  }
  return {
    onConfirm: () => {
      settle.done(true)
      clear()
    },
    onCancel: () => {
      settle.done(false)
      clear()
    },
    onClose: () => settle.done(false),
  }
}

export function isGuardRejection(err: unknown): boolean {
  return !!err && typeof err === "object" && (err as Record<string, unknown>)[GUARD_REJECTION] === true
}

/** Human summary for the confirm dialog, e.g. "now 02:30 UTC is PEAK, ...". */
export function peakSummary(ranges: TimeRange[], now: Date): string {
  try {
    const tr = nextTransition(ranges, now)
    const clock = formatMinutes(utcMinutes(now))
    const nextClock = formatMinutes(utcMinutes(tr.at))
    const wait = formatDuration(Math.max(0, Math.round((tr.at.getTime() - now.getTime()) / 60_000)))
    // Current state comes from the real status, not the transition direction:
    // with no flip in range (e.g. all-day windows) the scanner falls back to
    // `to: current`, which would invert the label.
    if (!statusForDate(now, ranges).peak) {
      return `now ${clock} UTC is off-peak, next peak ${nextClock} UTC`
    }
    if (tr.to) return `now ${clock} UTC is PEAK (no further flip in range)`
    return `now ${clock} UTC is PEAK, off-peak ${nextClock} UTC in ${wait}`
  } catch {
    return "peak pricing is active"
  }
}

/** Human summary for the confirm dialog from the coverage array (reference: peakSummary). */
export function peakSummaryFromRuns(runs: PeakRun[], now: Date): string {
  try {
    const tr = nextTransitionInRuns(runs, now)
    const clock = formatMinutes(utcMinutes(now))
    const nextClock = formatMinutes(utcMinutes(tr.at))
    const wait = formatDuration(Math.max(0, Math.round((tr.at.getTime() - now.getTime()) / 60_000)))
    // Current state comes from the real status, not the transition direction:
    // with no flip in range (e.g. all-day windows) the reader falls back to
    // `to: current`, which would invert the label.
    if (!statusForRuns(runs, now)) {
      return `now ${clock} UTC is off-peak, next peak ${nextClock} UTC`
    }
    if (tr.to) return `now ${clock} UTC is PEAK (no further flip in range)`
    return `now ${clock} UTC is PEAK, off-peak ${nextClock} UTC in ${wait}`
  } catch {
    return "peak pricing is active"
  }
}

/** Friendly last-outcome label for the sidebar ("sent 02:31", "off-peak", ...). */
export function formatLastActivity(activity: GuardActivity | null): string | null {
  if (!activity) return null
  const clock = formatMinutes(utcMinutes(new Date(activity.at)))
  switch (activity.outcome) {
    case "sent":
      return `last sent ${clock}`
    case "cancelled":
      return `last cancelled ${clock}`
    case "warned":
      return `last warned ${clock}`
    case "blocked":
      return `last blocked ${clock}`
    case "error":
      return `last error ${clock}`
    case "pass":
      if (activity.reason === "off-peak") return "off-peak"
      if (activity.reason === "non-target-model") return "non-DeepSeek"
      if (activity.reason === "cooldown") return `cooldown until ${clock}`
      return null
  }
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined
}

/**
 * Resolve the model for one `session.prompt` call. Precedence: explicit call
 * args (authoritative for this send, covers just-switched models and brand
 * new sessions) > stored session model > configured default model.
 */
export function resolvePromptModel(
  params: Record<string, unknown> | undefined | null,
  deps: Pick<PromptGuardDeps, "getSessionModel" | "getDefaultModel">,
): PromptModel {
  const p = (params ?? {}) as Record<string, unknown>
  const nested = p.model as Record<string, unknown> | undefined
  let providerID = str(nested?.providerID) ?? str(p.providerID)
  let modelID = str(nested?.modelID) ?? str(p.modelID)
  if (!providerID || !modelID) {
    try {
      const s = deps.getSessionModel(str(p.sessionID) ?? "")
      providerID = providerID ?? s.providerID
      modelID = modelID ?? s.modelID
    } catch {
      // ignore session lookup errors, fall through to defaults
    }
  }
  if (!providerID && !modelID) {
    try {
      const d = deps.getDefaultModel()
      providerID = d.providerID
      modelID = d.modelID
    } catch {
      // ignore config lookup errors; unknown model fails open below
    }
  }
  return { providerID, modelID }
}

type AnyFn = (...args: any[]) => Promise<unknown>

/**
 * Minimal host surface the prompt guard needs: a client object carrying the
 * session sender plus an optional dispose hook. Both the v1 `TuiPluginApi`
 * and the v2 CLI context satisfy this structurally, so one wrapper serves
 * both generations (v2 passes `{ client: context.client }` and disposes via
 * the cleanup function returned from `setup`).
 */
export interface PromptGuardHost {
  client?: { session?: unknown }
  lifecycle?: { onDispose: (fn: () => void) => unknown }
}

function readSession(host: PromptGuardHost): any {
  try {
    return host?.client?.session
  } catch {
    return undefined
  }
}

/**
 * Wrap `session.prompt` / `session.promptAsync`. Never touches `command`,
 * `shell`, or anything else, so control-plane actions always work.
 */
export function installPromptGuard(host: PromptGuardHost, deps: PromptGuardDeps): PromptGuardHandle {
  let origPrompt: AnyFn | undefined
  let origPromptAsync: AnyFn | undefined
  let hadOwnPrompt = false
  let hadOwnPromptAsync = false
  let target: any
  let confirmPending = false
  let lastWarnAt = 0
  let disposed = false
  let timer: ReturnType<typeof setInterval> | undefined

  const state = { installed: false, reason: "not-installed" }

  const setState = (installed: boolean, reason: string) => {
    state.installed = installed
    state.reason = reason
    try {
      deps.onState?.(installed)
    } catch {
      // ignore observer errors
    }
  }

  const wrapped = (orig: () => AnyFn | undefined) =>
    async function (this: unknown, ...args: any[]): Promise<unknown> {
      const fn = orig()
      // Decision + dialog plumbing. Any internal failure fails OPEN (plain
      // passthrough) so a guard bug can never strand the user. Only explicit
      // user cancellation rejects, which the host surfaces as a toast.
      let decision: ReturnType<typeof shouldGuard> | undefined
      let model: PromptModel = {}
      try {
        const params = (args[0] ?? {}) as Record<string, unknown>
        model = resolvePromptModel(params, deps)
        const now = new Date()
        decision = shouldGuard({
          now,
          ranges: deps.ranges(),
          providerID: model.providerID,
          modelID: model.modelID,
          settings: deps.settings(),
          lastAck: deps.lastAck(),
        })
      } catch {
        return (fn as AnyFn).apply(this, args)
      }

      const at = Date.now()
      if (decision.warn) {
        // Warn mode never blocks. Repeat toasts follow the cooldown exactly:
        // cooldown 0 means every send toasts.
        const quietMs = deps.settings().cooldownMs
        if (quietMs <= 0 || at - lastWarnAt >= quietMs) {
          lastWarnAt = at
          try {
            deps.toast("Sent during DeepSeek peak rates", "warning")
          } catch {
            // ignore toast errors
          }
        }
        try {
          deps.notify({ at, outcome: "warned", reason: "peak" })
        } catch {
          // ignore observer errors
        }
        return (fn as AnyFn).apply(this, args)
      }
      if (!decision.guard) {
        try {
          deps.notify({ at, outcome: "pass", reason: decision.reason })
        } catch {
          // ignore observer errors
        }
        return (fn as AnyFn).apply(this, args)
      }

      if (confirmPending) {
        try {
          deps.notify({ at, outcome: "blocked", reason: "confirm-pending" })
        } catch {
          // ignore observer errors
        }
        throw guardError("Peak guard: confirmation already pending")
      }
      confirmPending = true
      let confirmed: boolean
      try {
        // Prefer the prebuilt coverage array; fall back to a local build so a
        // missing accessor can never break the dialog (once per prompt).
        const coverage = deps.runs?.() ?? buildCoverageRuns(deps.ranges())
        confirmed = await deps.showConfirm(peakSummaryFromRuns(coverage, new Date()))
      } catch {
        // Dialog unavailable: fail open rather than strand the user.
        confirmed = true
        try {
          deps.notify({ at: Date.now(), outcome: "error", reason: "confirm-unavailable" })
        } catch {
          // ignore observer errors
        }
      } finally {
        confirmPending = false
      }
      if (!confirmed) {
        try {
          deps.notify({ at: Date.now(), outcome: "cancelled", reason: "peak" })
        } catch {
          // ignore observer errors
        }
        throw guardError("Cancelled during DeepSeek peak rates — confirm to send")
      }
      try {
        deps.ack(Date.now())
      } catch {
        // ignore kv errors; cooldown just won't persist
      }
      try {
        deps.notify({ at: Date.now(), outcome: "sent", reason: "peak-ack" })
      } catch {
        // ignore observer errors
      }
      return (fn as AnyFn).apply(this, args)
    }

  const patch = (): boolean => {
    const session = readSession(host)
    if (!session || typeof session.prompt !== "function") return false
    if ((session.prompt as Record<string, unknown>)[MARK] === true) {
      target = session
      return true // already ours (e.g. after a re-patch check)
    }
    origPrompt = session.prompt as AnyFn
    hadOwnPrompt = Object.hasOwn(session, "prompt")
    const wrappedPrompt = wrapped(() => origPrompt) as AnyFn
    ;((wrappedPrompt as unknown) as Record<string, unknown>)[MARK] = true
    try {
      session.prompt = wrappedPrompt
    } catch {
      return false
    }
    if (typeof session.promptAsync === "function" && (session.promptAsync as Record<string, unknown>)[MARK] !== true) {
      origPromptAsync = session.promptAsync as AnyFn
      hadOwnPromptAsync = Object.hasOwn(session, "promptAsync")
      const wrappedAsync = wrapped(() => origPromptAsync) as AnyFn
      ;((wrappedAsync as unknown) as Record<string, unknown>)[MARK] = true
      try {
        session.promptAsync = wrappedAsync
      } catch {
        // promptAsync is a bonus; prompt alone is enough
        origPromptAsync = undefined
      }
    }
    target = session
    return true
  }

  const ensurePatched = () => {
    if (disposed) return
    let session: any
    try {
      session = readSession(host)
    } catch {
      session = undefined
    }
    if (session && target && session === target && (session.prompt as Record<string, unknown>)?.[MARK] === true) {
      if (!state.installed) setState(true, "ok")
      return // still patched (covers host.client rotation to the same object)
    }
    if (session && session !== target) {
      // Client rotated: restore the old target if we still can, then patch new.
      try {
        uninstallMethods()
      } catch {
        // ignore restore errors on a discarded object
      }
    }
    if (patch()) {
      setState(true, "ok")
    } else if (state.installed || state.reason !== "no-session.prompt") {
      setState(false, "no-session.prompt")
    }
  }

  const uninstallMethods = () => {
    if (!target) return
    try {
      if (origPrompt) {
        if (hadOwnPrompt) target.prompt = origPrompt
        else delete target.prompt
      }
    } catch {
      // ignore restore errors
    }
    try {
      if (origPromptAsync) {
        if (hadOwnPromptAsync) target.promptAsync = origPromptAsync
        else delete target.promptAsync
      }
    } catch {
      // ignore restore errors
    }
    origPrompt = undefined
    origPromptAsync = undefined
    target = undefined
  }

  const uninstall = () => {
    disposed = true
    if (timer !== undefined) {
      try {
        clearInterval(timer)
      } catch {
        // ignore cleanup errors
      }
      timer = undefined
    }
    try {
      uninstallMethods()
    } catch {
      // ignore restore errors
    }
    setState(false, "uninstalled")
  }

  if (patch()) {
    setState(true, "ok")
  } else {
    setState(false, "no-session.prompt")
  }
  timer = setInterval(ensurePatched, REPATCH_MS)
  try {
    ;(timer as unknown as { unref?: () => void }).unref?.()
  } catch {
    // unref unavailable on this runtime; cleared on dispose regardless
  }
  try {
    host.lifecycle?.onDispose(uninstall)
  } catch {
    // lifecycle unavailable; interval + explicit uninstall still work
  }

  return {
    get installed() {
      return state.installed
    },
    get reason() {
      return state.reason
    },
    isInstalled: () => state.installed,
    ensurePatched,
    uninstall,
  }
}
