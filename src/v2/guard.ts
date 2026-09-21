import type { Context } from "@opencode/plugin/tui/context"
import type { PromptGuardDeps, PromptModel } from "../guard-intercept.ts"
import type { GuardSettings, TimeRange } from "../types.ts"
import { formatDuration } from "../ranges.ts"

/**
 * v2 prompt-guard dependencies: same interception semantics as v1 (wrap the
 * client's `session.prompt`, confirm before DeepSeek sends during peak),
 * but against the v2 CLI context.
 *
 * Model resolution differs from v1: the session's live model
 * (`data.session.get`) is authoritative (covers just-switched models and
 * brand-new sessions, which already carry the server default). There is no
 * v2 TUI equivalent of the old global-config default, so an unknown model
 * fails open — same as the v1 "unknown model" path, and visible on the
 * sidebar `Guard:` line.
 */
export function v2GuardDeps(
  context: Context,
  parts: {
    ranges: () => TimeRange[]
    runs: () => import("../ranges.ts").PeakRun[]
    settings: () => GuardSettings
    lastAck: () => number
    ack: (at?: number) => void
    notify: PromptGuardDeps["notify"]
    onState: PromptGuardDeps["onState"]
  },
): PromptGuardDeps {
  const getSessionModel = (sessionID: string): PromptModel => {
    try {
      const model = context.data.session.get(sessionID)?.model
      if (!model) return {}
      return { providerID: model.providerID, modelID: model.id }
    } catch {
      return {}
    }
  }

  const showConfirm = async (summary: string): Promise<boolean> => {
    const cooldownMs = parts.settings().cooldownMs
    const cooldownNote =
      cooldownMs > 0
        ? `Confirming silences this check for ${formatDuration(Math.round(cooldownMs / 60_000))}.`
        : "You will be asked again on every prompt."
    try {
      // `undefined` (dismissed/stolen dialog) counts as cancel: never send
      // on an ambiguous answer. Plumbing failures fail open in the wrapper.
      const ok = await context.ui.dialog.confirm({
        title: "DeepSeek peak pricing",
        message: `Peak rates apply (${summary}). Send anyway? ${cooldownNote}`,
        label: { confirm: "Send", cancel: "Cancel" },
      })
      return ok === true
    } catch {
      // Re-throw so the wrapper's fail-open path records "confirm-unavailable"
      // instead of silently treating it as a cancel.
      throw new Error("peak confirm dialog unavailable")
    }
  }

  return {
    ranges: parts.ranges,
    runs: parts.runs,
    settings: parts.settings,
    lastAck: parts.lastAck,
    ack: parts.ack,
    showConfirm,
    notify: parts.notify,
    toast: (message, variant = "info") => {
      try {
        context.ui.toast.show({ message, variant })
      } catch {
        // ignore toast errors
      }
    },
    getSessionModel,
    // No v2 TUI default-model source; session model (or call args) decides.
    getDefaultModel: () => ({}),
    onState: parts.onState,
  }
}
