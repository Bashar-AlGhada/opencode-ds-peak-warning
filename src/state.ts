import {
  coerceCoverageDoc,
  makeCoverageDoc,
  migrateLegacyRanges,
  sanitizeRanges,
} from "./ranges.ts"
import type { CoverageDoc } from "./ranges.ts"
import {
  DEFAULT_GUARD_COOLDOWN_MS,
  DEFAULT_GUARD_ENABLED,
  DEFAULT_GUARD_PROVIDERS,
  DEFAULT_RANGES,
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_PANEL_KEY,
  KV_RANGES_KEY,
  KV_RUNS_KEY,
  WEEKDAY_DEFAULT_DAYS,
  coercePanelVisible,
} from "./config.ts"
import type { DsPeakOptions, GuardSettings, TimeRange } from "./types.ts"
import type { KvLike } from "./kv.ts"
import { sanitizeGuardSettings } from "./guard.ts"

// Shared state loaders: one precedence implementation for both plugin
// generations (v1 TuiPluginApi.kv and the v2 storage adapter both satisfy
// KvLike). Pure reads over kv + options; callers persist forward.

/**
 * Resolve the effective peak windows. Each entry may carry a day-of-week
 * pattern. Precedence: saved KV value > plugin `ranges` option > built-in
 * weekday defaults.
 */
export function resolveEffectiveRanges(kv: KvLike, opts: Partial<DsPeakOptions>): TimeRange[] {
  try {
    // Prefer what the user last saved through /dspeak (day patterns included).
    const fromKv = kv.get(KV_RANGES_KEY)
    if (Array.isArray(fromKv)) {
      const cleaned = sanitizeRanges(fromKv)
      if (cleaned.length) return migrateLegacyRanges(cleaned, WEEKDAY_DEFAULT_DAYS)
    }
  } catch {
    // ignore kv read errors, fall through
  }
  const fromOpts = opts.ranges
  if (Array.isArray(fromOpts) && fromOpts.length) {
    const cleaned = sanitizeRanges(fromOpts)
    if (cleaned.length) return migrateLegacyRanges(cleaned, WEEKDAY_DEFAULT_DAYS)
  }
  return DEFAULT_RANGES.map((r) => ({ ...r, days: r.days ? [...r.days] : undefined }))
}

/**
 * Load the coverage document: a valid persisted doc is trusted (fingerprint
 * verified inside coerceCoverageDoc); anything else rebuilds the merged array
 * from the effective ranges. The caller saves forward when rebuilt.
 */
export function loadCoverage(kv: KvLike, opts: Partial<DsPeakOptions>): { doc: CoverageDoc; rebuilt: boolean } {
  try {
    const fromKv = kv.get(KV_RUNS_KEY)
    const doc = coerceCoverageDoc(fromKv)
    if (doc) return { doc, rebuilt: false }
  } catch {
    // ignore kv read errors, rebuild below
  }
  return { doc: makeCoverageDoc(resolveEffectiveRanges(kv, opts)), rebuilt: true }
}

/** Persist both the coverage doc and the legacy plain-array key (rollback safety). */
export function persistCoverage(kv: KvLike, doc: CoverageDoc): void {
  try {
    kv.set(KV_RUNS_KEY, doc)
  } catch {
    // kv may be unavailable; keep in-memory state
  }
  try {
    kv.set(KV_RANGES_KEY, doc.ranges)
  } catch {
    // kv may be unavailable; keep in-memory state
  }
}

export function defaultGuard(): GuardSettings {
  return {
    enabled: DEFAULT_GUARD_ENABLED,
    mode: "block",
    cooldownMs: DEFAULT_GUARD_COOLDOWN_MS,
    providers: [...DEFAULT_GUARD_PROVIDERS],
  }
}

/** Precedence: saved KV value > plugin `guard` option > defaults (guard on). */
export function loadGuard(kv: KvLike, opts: Partial<DsPeakOptions>): GuardSettings {
  const fallback = sanitizeGuardSettings(opts.guard, defaultGuard())
  try {
    const fromKv = kv.get(KV_GUARD_KEY)
    if (fromKv && typeof fromKv === "object") return sanitizeGuardSettings(fromKv, fallback)
  } catch {
    // ignore kv read errors
  }
  return fallback
}

export function loadLastAck(kv: KvLike): number {
  try {
    const v = kv.get(KV_GUARD_ACK_KEY)
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v)
  } catch {
    // ignore kv read errors
  }
  return 0
}

/**
 * Sidebar panel visibility. Precedence: saved KV toggle > plugin `panel`
 * option > visible. A non-boolean KV entry (missing key, wrong type) falls
 * through to the option/default instead of hiding the panel.
 */
export function loadPanelVisible(kv: KvLike, opts: Partial<DsPeakOptions>): boolean {
  const fallback = typeof opts.panel === "boolean" ? opts.panel : true
  try {
    return coercePanelVisible(kv.get(KV_PANEL_KEY), fallback)
  } catch {
    // ignore kv read errors
  }
  return fallback
}
