import { statusForDate } from "./ranges.ts"
import type { GuardSettings, TimeRange } from "./types.ts"

// Pure peak-guard decision logic (no Solid, no TUI api) so it can be unit
// tested in scripts/sanity-check.mjs.

export interface GuardContext {
  now: Date
  ranges: TimeRange[]
  /** Provider id (e.g. "deepseek") or undefined when unknown. */
  providerID?: string
  /** Model id (e.g. "deepseek-chat") or undefined when unknown. */
  modelID?: string
  settings: GuardSettings
  /** Last acknowledgement timestamp (ms since epoch), 0/undefined = never. */
  lastAck?: number
}

export interface GuardDecision {
  /** True when the prompt must ask for confirmation (peak + target + no cooldown + block mode). */
  guard: boolean
  /** True when peak + target + no cooldown but mode is "warn" (never blocks). */
  warn: boolean
  /** Machine-readable reason for the decision (for tests/toasts). */
  reason: "disabled" | "off-peak" | "non-target-model" | "cooldown" | "peak"
  /** True when currently inside a peak window (regardless of model/cooldown). */
  peak: boolean
}

/** Case-insensitive substring match against the provider allowlist. */
export function matchesProviders(
  providerID: string | undefined,
  modelID: string | undefined,
  providers: string[],
): boolean {
  if (!providers.length) return true
  const hay = `${providerID ?? ""} ${modelID ?? ""}`.toLowerCase()
  return providers.some((p) => p && hay.includes(p.toLowerCase()))
}

/** True when an acknowledgement is still inside the cooldown window. */
export function isCooldownActive(lastAck: number | undefined, cooldownMs: number, at: number): boolean {
  if (!cooldownMs || cooldownMs <= 0) return false
  if (!lastAck) return false
  return at - lastAck < cooldownMs
}

/** Decide whether a prompt submit must be gated right now. */
export function shouldGuard(ctx: GuardContext): GuardDecision {
  const at = ctx.now.getTime()
  if (!ctx.settings.enabled) return { guard: false, warn: false, reason: "disabled", peak: false }
  const peak = statusForDate(ctx.now, ctx.ranges).peak
  if (!peak) return { guard: false, warn: false, reason: "off-peak", peak }
  if (!matchesProviders(ctx.providerID, ctx.modelID, ctx.settings.providers)) {
    return { guard: false, warn: false, reason: "non-target-model", peak }
  }
  if (isCooldownActive(ctx.lastAck, ctx.settings.cooldownMs, at)) {
    return { guard: false, warn: false, reason: "cooldown", peak }
  }
  if (ctx.settings.mode === "warn") return { guard: false, warn: true, reason: "peak", peak }
  return { guard: true, warn: false, reason: "peak", peak }
}

/** Parse a config model string like "deepseek/deepseek-chat" (or with variant). */
export function parseConfigModel(model: unknown): { providerID?: string; modelID?: string } {
  if (typeof model !== "string" || !model.trim()) return {}
  // Formats seen: "provider/model", "provider/model@variant", "model" alone.
  const noVariant = model.split("@")[0]
  const parts = noVariant.split("/")
  if (parts.length >= 2) {
    const providerID = parts[0].trim() || undefined
    const modelID = parts.slice(1).join("/").trim() || undefined
    return { providerID, modelID }
  }
  return { modelID: noVariant.trim() || undefined }
}

/** Coerce untrusted guard settings (KV/options) onto resolved defaults. */
export function sanitizeGuardSettings(
  input: unknown,
  fallback: GuardSettings,
): GuardSettings {
  if (!input || typeof input !== "object") return { ...fallback, providers: [...fallback.providers] }
  const r = input as Record<string, unknown>
  const enabled = typeof r.enabled === "boolean" ? r.enabled : fallback.enabled
  const mode = r.mode === "warn" || r.mode === "block" ? r.mode : fallback.mode
  const cooldownMs =
    typeof r.cooldownMs === "number" && Number.isFinite(r.cooldownMs) && r.cooldownMs >= 0
      ? Math.floor(r.cooldownMs)
      : fallback.cooldownMs
  let providers: string[]
  if (Array.isArray(r.providers)) {
    providers = r.providers.filter((p): p is string => typeof p === "string" && p.trim().length > 0).map((p) => p.trim())
    if (!providers.length) providers = [...fallback.providers]
  } else {
    providers = [...fallback.providers]
  }
  return { enabled, mode, cooldownMs, providers }
}

/** Human cooldown label for menus ("off", "1m", "5m", "15m", "1h"). */
export function formatCooldown(cooldownMs: number): string {
  if (!cooldownMs || cooldownMs <= 0) return "off"
  const m = Math.round(cooldownMs / 60_000)
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem ? `${h}h ${rem}m` : `${h}h`
}
