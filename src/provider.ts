/** Providers/models whose pricing schedule is represented by the configured ranges. */
export const DEFAULT_STATUS_PROVIDERS: string[] = ["deepseek"]

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
