import type { Context } from "@opencode/plugin/tui/context"
import type { KvLike } from "../kv.ts"
import type { CoverageDoc } from "../ranges.ts"
import type { GuardSettings, TimeRange } from "../types.ts"
import {
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_PANEL_KEY,
  KV_RANGES_KEY,
  KV_RUNS_KEY,
} from "../config.ts"

type V2Storage = Context["storage"]

/**
 * Everything the plugin persists, in one durable JSON document. v2 storage
 * only takes objects (`store<Value extends object>`), so the scalar KV
 * entries (ack timestamp, panel flag) live as fields here instead of
 * separate keys. `null` means "never saved" — loaders fall back to
 * options/defaults in that case.
 *
 * The first load uses options/defaults; in-app `/dspeak` edits persist
 * afterward.
 */
export interface V2Persisted {
  coverage: CoverageDoc | null
  legacyRanges: TimeRange[] | null
  guard: GuardSettings | null
  lastAck: number
  panel: boolean | null
}

const INITIAL: V2Persisted = {
  coverage: null,
  legacyRanges: null,
  guard: null,
  lastAck: 0,
  panel: null,
}

/**
 * Adapt v2 durable storage to the shared KvLike surface, so the state loaders
 * (resolveEffectiveRanges, loadCoverage, loadGuard, …) stay independent of
 * the host storage API.
 * Reads come from the live solid store (synchronous snapshot); writes go
 * through the store mutator and persist async — a read-after-write in the
 * same tick still sees the write.
 *
 * Store key rule (host-enforced, see `segment()` in the TUI storage
 * provider): `^[a-zA-Z0-9][a-zA-Z0-9._-]*$` — no colons, no slashes. The
 * host already scopes storage per plugin (`plugin.<id>.<key>`), so a plain
 * `"state"` key is collision-free.
 */
export function createV2Kv(storage: V2Storage): KvLike {
  const [state, update] = storage.store<V2Persisted>("state", { initial: INITIAL })

  const write = (mutate: (draft: V2Persisted) => void): void => {
    try {
      // In-memory store updates synchronously; disk sync follows async.
      update(mutate).catch(() => {
        // persistence is best-effort; in-memory state already updated
      })
    } catch {
      // storage unavailable; keep in-memory state
    }
  }

  return {
    get(key: string): unknown {
      try {
        switch (key) {
          case KV_RUNS_KEY:
            return state.coverage ?? undefined
          case KV_RANGES_KEY:
            return state.legacyRanges ?? undefined
          case KV_GUARD_KEY:
            return state.guard ?? undefined
          case KV_GUARD_ACK_KEY:
            return state.lastAck
          case KV_PANEL_KEY:
            return state.panel ?? undefined
          default:
            return undefined
        }
      } catch {
        return undefined
      }
    },
    set(key: string, value: unknown): void {
      switch (key) {
        case KV_RUNS_KEY:
          write((draft) => {
            draft.coverage = value as CoverageDoc
          })
          break
        case KV_RANGES_KEY:
          write((draft) => {
            draft.legacyRanges = value as TimeRange[]
          })
          break
        case KV_GUARD_KEY:
          write((draft) => {
            draft.guard = value as GuardSettings
          })
          break
        case KV_GUARD_ACK_KEY:
          if (typeof value === "number") {
            const at = value
            write((draft) => {
              draft.lastAck = at
            })
          }
          break
        case KV_PANEL_KEY:
          if (typeof value === "boolean") {
            const visible = value
            write((draft) => {
              draft.panel = visible
            })
          }
          break
        default:
          break
      }
    },
  }
}
