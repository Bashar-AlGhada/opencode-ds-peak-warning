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
