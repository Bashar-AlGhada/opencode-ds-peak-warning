import { createSignal } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
import type { Definition } from "@opencode/plugin/tui/plugin"
import { makeCoverageDoc, migrateLegacyRanges, sanitizeRanges } from "../ranges.ts"
import type { CoverageDoc } from "../ranges.ts"
import { clockDiagnostics, ensureClockRunning, poke } from "../clock.ts"
import {
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_PANEL_KEY,
  WEEKDAY_DEFAULT_DAYS,
} from "../config.ts"
import type { DsPeakOptions, GuardSettings, TimeRange } from "../types.ts"
import { formatCooldown } from "../guard.ts"
import { loadCoverage, loadGuard, loadLastAck, loadPanelVisible, persistCoverage } from "../state.ts"
import { formatLastActivity, installPromptGuard, type GuardActivity } from "../guard-intercept.ts"
import { createV2Kv } from "./kv.ts"
import { V2_EVENT_TYPES } from "./events.ts"
import { v2GuardDeps } from "./guard.ts"
import { registerV2Slots } from "./slots.tsx"
import { openConfigMenuV2 } from "./dialogs.tsx"
import { adaptV2Theme } from "./theme.ts"

/** Stable plugin id: v2 storage is scoped by it; keep identical to v1. */
export const PLUGIN_ID = "ds-peak-warningx"

/**
 * v2 (opencode 2.x) CLI plugin setup. Mirrors the v1 `tui()` flow against
 * the v2 context: durable storage instead of KV, `dialog.show()` menus
 * instead of the v1 JSX dialog stack, slot claims instead of slot
 * registration, and a reactive keymap layer instead of
 * registerLayer/command fallback.
 *
 * No runtime import of `@opencode/plugin` here (only `import type`, erased
 * at transpile): the default export is a hand-written `{ id, setup }`
 * object (Plugin.define is identity at runtime; the v2 loader validates
 * structurally), so v1 hosts never face an unresolvable import.
 */
async function setupV2(context: Context): Promise<() => void> {
  const opts = (context.options ?? {}) as Partial<DsPeakOptions>
  const kv = createV2Kv(context.storage)
  ensureClockRunning()
  const initial = loadCoverage(kv, opts)
  if (initial.rebuilt) persistCoverage(kv, initial.doc)
  // Single choke point for window state, same as v1: every settings change
  // flows through `save`, which always rebuilds the merged coverage array.
  const [coverage, setCoverage] = createSignal<CoverageDoc>(initial.doc)
  const ranges = () => coverage().ranges
  const runs = () => coverage().runs
  const [guardSettings, setGuardSettings] = createSignal<GuardSettings>(loadGuard(kv, opts))
  const [lastAck, setLastAck] = createSignal<number>(loadLastAck(kv))
  const [panelVisible, setPanelVisible] = createSignal<boolean>(loadPanelVisible(kv, opts))
  const [activity, setActivity] = createSignal<GuardActivity | null>(null)
  const [guardInstalled, setGuardInstalled] = createSignal(false)

  const save = (next: TimeRange[]) => {
    // An explicitly emptied list means "no peak windows" (not "defaults").
    const doc = makeCoverageDoc(migrateLegacyRanges(sanitizeRanges(next), WEEKDAY_DEFAULT_DAYS))
    setCoverage(doc)
    persistCoverage(kv, doc)
  }

  const saveGuard = (next: GuardSettings) => {
    setGuardSettings(next)
    try {
      kv.set(KV_GUARD_KEY, next)
    } catch {
      // storage may be unavailable; keep in-memory state
    }
  }

  const savePanelVisible = (next: boolean) => {
    setPanelVisible(next)
    try {
      kv.set(KV_PANEL_KEY, next)
    } catch {
      // storage may be unavailable; keep in-memory state
    }
  }

  const ack = (at?: number) => {
    const ts = typeof at === "number" && Number.isFinite(at) ? Math.floor(at) : Date.now()
    setLastAck(ts)
    try {
      kv.set(KV_GUARD_ACK_KEY, ts)
    } catch {
      // storage may be unavailable; keep in-memory state
    }
  }

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
    try {
      context.ui.toast.show({ variant, message })
    } catch {
      // ignore toast errors
    }
  }

  // Peak guard: wraps `client.session.prompt` only (v2 has no promptAsync).
  // Slash commands, shell mode and settings never flow through that method,
  // so they structurally cannot deadlock — same design as v1.
  const guard = installPromptGuard(
    { client: context.client },
    v2GuardDeps(context, {
      ranges,
      runs,
      settings: guardSettings,
      lastAck,
      ack,
      notify: (a) => setActivity(a),
      onState: (installed) => setGuardInstalled(installed),
    }),
  )

  // Sidebar guard line: always visible when the guard is on, including the
  // last outcome — a silent fail-open (e.g. unknown model) shows up here.
  const guardLine = (): string | null => {
    const s = guardSettings()
    if (!s.enabled) return null
    if (!guardInstalled()) return "Guard: unavailable"
    const last = formatLastActivity(activity())
    const base = `Guard: ${s.mode} ${formatCooldown(s.cooldownMs)}`
    return last ? `${base} · ${last}` : base
  }

  // Watchdog fan-in over the v2 event catalog: every bus event pokes the
  // shared clock (rate-limited internally) and session lifecycle events
  // additionally re-apply the guard patch if the client rotated.
  const unsubs: Array<() => void> = []
  try {
    for (const t of V2_EVENT_TYPES) {
      try {
        unsubs.push(context.data.on(t as never, () => poke(t)))
      } catch {
        // unknown event type on this host; skip (counters reveal silent types)
      }
    }
  } catch {
    // event bus unavailable; timers + render-time checks still work
  }
  for (const t of ["session.created", "session.model.selected"] as const) {
    try {
      unsubs.push(
        context.data.on(t as never, () => {
          try {
            guard.ensurePatched()
          } catch {
            // ignore re-patch errors
          }
        }),
      )
    } catch {
      // unknown event type on this host; skip
    }
  }

  // Heartbeat snapshot for the /dspeak diagnostics row.
  const diagnosticLines = (): string[] => {
    const d = clockDiagnostics()
    const ageS = Math.max(0, Math.round((Date.now() - d.lastTickAt) / 1000))
    const lines = [
      `Clock: ${ageS === 0 ? "fresh" : `${ageS}s old`} · ${d.tickCount} ticks · ${d.refreshCount} refreshes`,
      `Coverage: ${coverage().runs.length} runs from ${coverage().ranges.length} windows`,
    ]
    const heard = Object.keys(d.eventCounts)
      .filter((t) => d.eventCounts[t] > 0)
      .sort()
    lines.push(heard.length ? `Events: ${heard.map((t) => `${t} ${d.eventCounts[t]}`).join(" · ")}` : "Events: none yet")
    const silent = V2_EVENT_TYPES.filter((t) => !(d.eventCounts[t] > 0))
    if (silent.length) {
      const groups = new Map<string, number>()
      for (const t of silent) {
        const parts = t.split(".")
        const key = parts[0] === "session" && parts[1] === "inbox" ? "session.inbox" : parts[0]
        groups.set(key, (groups.get(key) ?? 0) + 1)
      }
      lines.push(`Silent (${silent.length}): ${[...groups].map(([k, n]) => `${k}×${n}`).join(", ")}`)
    }
    return lines
  }

  // Back the /dspeak command with the JSX main menu + promise submenus.
  const configure = () =>
    openConfigMenuV2({
      dialog: context.ui.dialog,
      toast: context.ui.toast,
      theme: () => adaptV2Theme(context.theme),
      ranges,
      runs,
      save,
      guard: { settings: guardSettings, saveSettings: saveGuard, ack },
      panel: { visible: panelVisible, save: savePanelVisible },
      diagnostics: diagnosticLines,
    })
  // Pre-confirm from anywhere (palette or slash): starts the cooldown without
  // needing a pending prompt.
  const confirmPeak = () => {
    ack(Date.now())
    toast(`Peak acknowledged — quiet for ${formatCooldown(guardSettings().cooldownMs)}`, "warning")
  }

  // Slot claims (sidebar panel, footer dot, and the global command layer —
  // the layer registers from the app-slot component render so it has an
  // owning component; see commands.ts).
  const disposeSlots = registerV2Slots(context, {
    ranges,
    runs,
    panelVisible,
    guardLine,
    commands: { configure, confirmPeak },
  })

  return () => {
    for (const unsub of unsubs) {
      try {
        unsub()
      } catch {
        // ignore cleanup errors
      }
    }
    try {
      disposeSlots()
    } catch {
      // ignore cleanup errors
    }
    try {
      guard.uninstall()
    } catch {
      // ignore cleanup errors
    }
  }
}

/**
 * The v2 plugin definition. Hand-written `{ id, setup }` (no Plugin.define
 * call — it is identity at runtime and importing the value would add a
 * runtime dependency v1 hosts cannot resolve). The `satisfies` check pins
 * the v2 contract at typecheck time.
 */
export const v2plugin = { id: PLUGIN_ID, setup: setupV2 } satisfies Definition
