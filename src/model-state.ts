import { readFile, stat } from "node:fs/promises"
import { join } from "node:path"

export type SelectedModel = { providerID: string; modelID: string }
export type ModelIdentity = { providerID?: string; modelID?: string }
export const MODEL_STATE_POLL_MS = 100

/** Keep model overrides scoped to the session where /model was invoked. */
export function resolveVisibleModel(
  sessionID: string | undefined,
  homeModel: SelectedModel | undefined,
  selectedModels: ReadonlyMap<string, SelectedModel>,
  fallback: ModelIdentity,
): ModelIdentity {
  if (sessionID) return selectedModels.get(sessionID) ?? fallback
  return homeModel ?? fallback
}

/** Keep a resource reachable through the host lifecycle signal and dispose it once. */
export function retainUntilAbort(signal: AbortSignal, stop: () => void): () => void {
  let stopped = false
  const dispose = () => {
    if (stopped) return
    stopped = true
    signal.removeEventListener("abort", dispose)
    stop()
  }
  if (signal.aborted) dispose()
  else signal.addEventListener("abort", dispose, { once: true })
  return dispose
}

/** OpenCode stores the latest /model choice at the front of `recent`. */
export function modelFromState(value: unknown): SelectedModel | undefined {
  if (!value || typeof value !== "object") return undefined
  const recent = (value as { recent?: unknown }).recent
  if (!Array.isArray(recent)) return undefined
  const model = recent[0]
  if (!model || typeof model !== "object") return undefined

  const { providerID, modelID } = model as { providerID?: unknown; modelID?: unknown }
  if (typeof providerID !== "string" || typeof modelID !== "string") return undefined
  return { providerID, modelID }
}

/** Observe atomic rewrites of OpenCode's private model selection state. */
export function watchModelState(
  stateDir: string,
  onModel: (model: SelectedModel, owner?: string) => void,
  getOwner?: () => string | undefined,
): () => void {
  const file = join(stateDir, "model.json")
  let fingerprint: string | undefined
  let previousRecent: string | undefined
  let previousState: string | undefined
  let previousOwner = getOwner?.()
  let initialized = false
  let reading = false
  let stopped = false

  const load = async () => {
    if (reading || stopped) return
    reading = true
    const ownerBefore = getOwner?.()
    try {
      const info = await stat(file)
      const nextFingerprint = `${info.mtimeMs}:${info.size}:${info.ino}`
      if (nextFingerprint === fingerprint) {
        previousOwner = getOwner?.()
        return
      }
      const value = JSON.parse(await readFile(file, "utf8")) as { recent?: unknown }
      const model = modelFromState(value)
      if (!model) return
      const ownerAfter = getOwner?.()
      const recent = JSON.stringify(value.recent)
      const state = JSON.stringify(value)
      // Selecting recent[0] through /model produces an otherwise identical
      // rewrite, which is the only signal exposed by the v1 host.
      const selectionRewrite = recent !== previousRecent || state === previousState
      const ownerStable = !getOwner || (previousOwner === ownerBefore && ownerBefore === ownerAfter)
      const emit = initialized && selectionRewrite && ownerStable && !stopped

      fingerprint = nextFingerprint
      previousRecent = recent
      previousState = state
      previousOwner = ownerAfter
      initialized = true
      if (emit) onModel(model, ownerAfter)
    } catch (error) {
      if (!initialized && (error as NodeJS.ErrnoException).code === "ENOENT") {
        initialized = true
        previousOwner = getOwner?.()
      }
      // Atomic replacement can briefly leave no readable target; the next tick retries.
    } finally {
      reading = false
    }
  }

  void load()
  const timer = setInterval(() => void load(), MODEL_STATE_POLL_MS)
  return () => {
    stopped = true
    clearInterval(timer)
  }
}
