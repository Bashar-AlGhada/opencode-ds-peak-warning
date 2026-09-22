/** Providers/models whose pricing schedule is represented by the configured ranges. */
export const DEFAULT_STATUS_PROVIDERS: string[] = ["deepseek"]

/** Resolve plugin options without letting malformed values broaden the filter. */
export function resolveStatusProviders(value: unknown): string[] {
  if (value === undefined) return DEFAULT_STATUS_PROVIDERS
  if (!Array.isArray(value)) return DEFAULT_STATUS_PROVIDERS
  if (value.length === 0) return []

  const providers = value
    .filter((provider): provider is string => typeof provider === "string" && provider.trim().length > 0)
    .map((provider) => provider.trim())
  return providers.length > 0 ? providers : DEFAULT_STATUS_PROVIDERS
}

/**
 * Check whether a selected provider/model should show the pricing status.
 * Matching either field keeps provider aliases and model-specific IDs useful.
 */
export function statusProviderMatches(
  providerID: string | undefined,
  modelID: string | undefined,
  providers: readonly string[] = DEFAULT_STATUS_PROVIDERS,
): boolean {
  if (providers.length === 0) return true

  const target = `${providerID ?? ""}/${modelID ?? ""}`.toLowerCase()
  return providers.some((provider) => target.includes(provider.toLowerCase()))
}

/** Read the newly chosen model before OpenCode persists it to session state. */
export function modelFromSelectionEvent(
  event: unknown,
): { sessionID: string; providerID: string; modelID: string } | undefined {
  if (!event || typeof event !== "object") return undefined
  const data = (event as { data?: unknown }).data
  if (!data || typeof data !== "object") return undefined

  const { sessionID, model } = data as {
    sessionID?: unknown
    model?: { providerID?: unknown; id?: unknown }
  }
  if (typeof sessionID !== "string" || typeof model?.providerID !== "string" || typeof model.id !== "string") {
    return undefined
  }
  return { sessionID, providerID: model.providerID, modelID: model.id }
}
