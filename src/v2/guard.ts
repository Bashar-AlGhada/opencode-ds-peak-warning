import type { Context } from "@opencode/plugin/tui/context"
import type { PromptGuardDeps, PromptModel } from "../guard-intercept.ts"
import { modelFromObj } from "../guard-intercept.ts"
import type { GuardSettings, TimeRange } from "../types.ts"
import { formatDuration } from "../ranges.ts"

/**
 * Pull a model ref out of a server `session.get` response of unknown exact
 * shape. Only `model`/`session`/`data` positions are descended into, and a
 * bare envelope `id` is never read as a model id (that would misread a
 * session id as the model). Returns undefined when nothing model-like shows.
 */
export function extractServerModel(value: unknown): PromptModel | undefined {
  const visit = (node: unknown, depth: number, inModelPosition: boolean): PromptModel | undefined => {
    if (!node || typeof node !== "object" || depth > 3) return undefined
    const direct = modelFromObj(node)
    if (direct?.providerID) return direct
    if (direct?.modelID && inModelPosition) return direct
    const o = node as Record<string, unknown>
    return (
      visit(o.model, depth + 1, true) ?? visit(o.session, depth + 1, false) ?? visit(o.data, depth + 1, false)
    )
  }
  return visit(value, 0, false)
}

/**
 * v2 prompt-guard dependencies: same interception semantics as v1 (wrap the
 * client's `session.prompt`, confirm before DeepSeek sends during peak),
 * but against the v2 CLI context.
 *
 * Model resolution: prompt call args first, then a prompt-time server read
 * during peak hours (the server owns the session model, so this stays
 * correct across `/model` switches), then the local `data.session` cache.
 * There is no v2 TUI equivalent of the old global-config default, so an
 * unknown model fails open — same as the v1 "unknown model" path, and
 * visible on the sidebar `Guard:` line.
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

  // Authoritative server read for the prompt-time guard check. The server
  // owns the session model, so this beats the local cache when a prompt
  // races a `/model` switch. Read-only probes across the
  // known client shapes (`{sessionID}`, `{path:{id}}`, bare id); anything
  // unexpected returns undefined and the cached chain decides. Envelopes
  // never contribute their own `id` (that would misread a session id as a
  // model id) — only `model`/`session`/`data` positions are descended into.
  const getServerModel = async (sessionID: string): Promise<PromptModel | undefined> => {
    try {
      const session = (context as unknown as { client?: { session?: unknown } }).client?.session as
        | { get?: unknown }
        | undefined
      if (!session || typeof session.get !== "function") return undefined
      const get = session.get as (arg: unknown) => Promise<unknown>
      for (const shape of [{ sessionID }, { path: { id: sessionID } }, sessionID]) {
        try {
          const model = extractServerModel(await get.call(session, shape))
          if (model?.providerID || model?.modelID) return model
        } catch {
          // wrong shape or unreachable — try the next shape
        }
      }
    } catch {
      // client unavailable — cached chain decides
    }
    return undefined
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
    // Authoritative prompt-time server read (peak only, timeout-guarded).
    getServerModel,
    onState: parts.onState,
  }
}
