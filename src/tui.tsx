/** @jsxImportSource @opentui/solid */
import { createSignal, Show } from "solid-js"
import type { TuiPlugin, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  makeCoverageDoc,
  migrateLegacyRanges,
  sanitizeRanges,
} from "./ranges.ts"
import type { CoverageDoc } from "./ranges.ts"
import {
  CLOCK_EVENT_TYPES,
  clockDiagnostics,
  ensureClockRunning,
  poke,
} from "./clock.ts"
import {
  DEFAULT_SLOT_ORDER,
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_PANEL_KEY,
  WEEKDAY_DEFAULT_DAYS,
} from "./config.ts"
import type { DsPeakOptions, GuardSettings, TimeRange } from "./types.ts"
import { formatCooldown } from "./guard.ts"
import { resolveStatusProviders, statusProviderMatches } from "./provider.ts"
import { loadCoverage, loadGuard, loadLastAck, loadPanelVisible, persistCoverage } from "./state.ts"
import { formatLastActivity, installPromptGuard, type GuardActivity } from "./guard-intercept.ts"
import { parseConfigModel } from "./guard.ts"
import { openConfigMenu } from "./dialogs.tsx"
import { showPeakConfirmDialog } from "./guard-ui.tsx"
import { PeakPanel, PeakPanelMini } from "./panel.tsx"
import { PeakHomeIndicator } from "./home.tsx"

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as Partial<DsPeakOptions>
  ensureClockRunning()
  const initial = loadCoverage(api.kv, opts)
  if (initial.rebuilt) persistCoverage(api.kv, initial.doc)
  // Single choke point for window state: every settings change flows through
  // `save`, which always rebuilds the merged coverage array with it — the
  // array cannot go stale relative to the settings.
  const [coverage, setCoverage] = createSignal<CoverageDoc>(initial.doc)
  const ranges = () => coverage().ranges
  const runs = () => coverage().runs
  const [guardSettings, setGuardSettings] = createSignal<GuardSettings>(loadGuard(api.kv, opts))
  const [lastAck, setLastAck] = createSignal<number>(loadLastAck(api.kv))
  const [panelVisible, setPanelVisible] = createSignal<boolean>(loadPanelVisible(api.kv, opts))
  const [activity, setActivity] = createSignal<GuardActivity | null>(null)
  const [guardInstalled, setGuardInstalled] = createSignal(false)
  const statusProviders = resolveStatusProviders(opts.statusProviders)
  const [modelRefresh, setModelRefresh] = createSignal(0)

  // Update in-memory state and persist to KV so edits survive restarts.
  // Re-sanitizes defensively so even a hypothetical direct caller cannot
  // store ranges without a matching freshly-built array.
  const save = (next: TimeRange[]) => {
    // An explicitly emptied list means "no peak windows" (not "defaults").
    const doc = makeCoverageDoc(migrateLegacyRanges(sanitizeRanges(next), WEEKDAY_DEFAULT_DAYS))
    setCoverage(doc)
    persistCoverage(api.kv, doc)
  }

  const saveGuard = (next: GuardSettings) => {
    setGuardSettings(next)
    try {
      api.kv.set(KV_GUARD_KEY, next)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
  }

  // Sidebar panel toggle: in-memory signal for instant hiding plus KV so the
  // choice survives restarts. The home-screen status dot is unaffected.
  const savePanelVisible = (next: boolean) => {
    setPanelVisible(next)
    try {
      api.kv.set(KV_PANEL_KEY, next)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
  }

  const ack = (at?: number) => {
    const ts = typeof at === "number" && Number.isFinite(at) ? Math.floor(at) : Date.now()
    setLastAck(ts)
    try {
      api.kv.set(KV_GUARD_ACK_KEY, ts)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
  }

  const toast = (message: string, variant: "info" | "success" | "warning" | "error" = "info") => {
    try {
      api.ui.toast({ variant, message })
    } catch {
      // ignore toast errors
    }
  }

  // Model resolvers for the interceptor: stored session model, then the
  // configured default (e.g. "deepseek/deepseek-chat").
  const getSessionModel = (sessionID: string) => {
    try {
      const session = api.state.session.get(sessionID) as
        | { model?: { id?: string; providerID?: string } }
        | undefined
      if (!session?.model) return {}
      return { providerID: session.model.providerID, modelID: session.model.id }
    } catch {
      return {}
    }
  }
  const getDefaultModel = () => {
    try {
      return parseConfigModel((api.state.config as { model?: unknown })?.model)
    } catch {
      return {}
    }
  }

  const statusVisible = (sessionID?: string) => {
    modelRefresh()
    const model = sessionID ? getSessionModel(sessionID) : getDefaultModel()
    return statusProviderMatches(model.providerID, model.modelID, statusProviders)
  }
  const getCurrentSessionID = (): string | undefined => {
    const route = api.route.current
    const sessionID = route.name === "session" ? route.params?.sessionID : undefined
    return typeof sessionID === "string" ? sessionID : undefined
  }

  // Peak guard: wraps `client.session.prompt`/`promptAsync` only. Slash
  // commands, shell mode, session switching and settings never flow through
  // those methods, so they structurally cannot deadlock — unlike the old
  // disabled-prompt approach, which blocked all input including the confirm
  // command itself.
  const guard = installPromptGuard(api, {
    ranges,
    runs,
    settings: guardSettings,
    lastAck,
    ack,
    showConfirm: (summary) => showPeakConfirmDialog(api, summary, guardSettings().cooldownMs),
    notify: (a) => setActivity(a),
    toast,
    getSessionModel,
    getDefaultModel,
    onState: (installed) => setGuardInstalled(installed),
  })

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

  // Watchdog fan-in, subscribed EXACTLY ONCE per process (not per view): every
  // bus event pokes the shared clock (rate-limited internally, so firehose
  // tiers are safe) and session updates additionally re-apply the guard patch
  // if the client rotated. Views react to the clock signal automatically, so
  // they need no subscriptions of their own. Wake-from-sleep heals on first
  // interaction instead of waiting for a timer.
  try {
    for (const t of CLOCK_EVENT_TYPES) {
      try {
        api.event.on(t as never, () => poke(t))
      } catch {
        // unknown event type on this host; skip (counters reveal silent types)
      }
    }
  } catch {
    // event bus unavailable; timers + render-time checks still work
  }
  try {
    api.event.on("session.updated" as never, () => {
      setModelRefresh((value) => value + 1)
      try {
        guard.ensurePatched()
      } catch {
        // ignore re-patch errors
      }
    })
  } catch {
    // unknown event type on this host; skip
  }
  try {
    api.event.on("session.model.selected" as never, () => setModelRefresh((value) => value + 1))
  } catch {
    // unknown event type on this host; skip
  }

  // Heartbeat snapshot for the /dspeak diagnostics row: clock age, tick and
  // refresh counters, coverage size, and per-type reception counts (including
  // silent types, so a never-firing subscription is visible, not trusted).
  const diagnosticLines = (): string[] => {
    const d = clockDiagnostics()
    const ageS = Math.max(0, Math.round((Date.now() - d.lastTickAt) / 1000))
    const lines = [
      `Clock: ${ageS === 0 ? "fresh" : `${ageS}s old`} · ${d.tickCount} ticks · ${d.refreshCount} refreshes`,
      `Coverage: ${coverage().runs.length} runs from ${coverage().ranges.length} windows`,
    ]
    // Heard counts cover every key ever poked (including ad-hoc sources like
    // "stale-heal"), not just the subscribed tiers.
    const heard = Object.keys(d.eventCounts)
      .filter((t) => d.eventCounts[t] > 0)
      .sort()
    lines.push(heard.length ? `Events: ${heard.map((t) => `${t} ${d.eventCounts[t]}`).join(" · ")}` : "Events: none yet")
    const silent = CLOCK_EVENT_TYPES.filter((t) => !(d.eventCounts[t] > 0))
    if (silent.length) {
      // Grouped by area so ~90 silent types stay one readable line.
      const groups = new Map<string, number>()
      for (const t of silent) {
        const parts = t.split(".")
        const key = parts[0] === "session" && parts[1] === "next" ? "session.next" : parts[0]
        groups.set(key, (groups.get(key) ?? 0) + 1)
      }
      lines.push(`Silent (${silent.length}): ${[...groups].map(([k, n]) => `${k}×${n}`).join(", ")}`)
    }
    return lines
  }

  const order = typeof opts.order === "number" ? opts.order : DEFAULT_SLOT_ORDER

  // Info-only slots (sidebar panel + home indicator). The guard no longer
  // replaces the prompt, so there is no replace-mode conflict with prompt
  // plugins such as vim. The sidebar panel is gated on the visibility
  // signal, so the /dspeak toggle applies live; hidden state collapses to
  // the compact status/disclaimer/edit line instead of disappearing.
  try {
    api.slots.register({
      order,
      slots: {
        // Render the pricing panel in the session sidebar (togglable, on by default).
        sidebar_content(ctx) {
          return (
            <Show
              when={panelVisible()}
              fallback={
                <Show when={statusVisible(getCurrentSessionID())}>
                  <PeakPanelMini theme={ctx.theme.current} ranges={ranges} runs={runs} />
                </Show>
              }
            >
              <Show when={statusVisible(getCurrentSessionID())}>
                <PeakPanel theme={ctx.theme.current} ranges={ranges} runs={runs} guardLine={guardLine} />
              </Show>
            </Show>
          )
        },
        // Keep the pricing status visible when the sidebar collapses on narrow terminals.
        session_prompt_right(ctx) {
          return (
            <PeakHomeIndicator
              theme={ctx.theme.current}
              ranges={ranges}
              runs={runs}
              visible={() => statusVisible(getCurrentSessionID())}
            />
          )
        },
        // Render the minimal PEAK/OFF-PEAK dot on the landing screen.
        home_prompt_right(ctx) {
          return <PeakHomeIndicator theme={ctx.theme.current} ranges={ranges} runs={runs} visible={() => statusVisible()} />
        },
      },
    })
  } catch (err) {
    api.ui.toast({
      variant: "error",
      title: "ds-peak-warningx",
      message: `Slot registration failed: ${(err as Error).message}`,
    })
  }

  // Back the /dspeak command with the config menu dialogs.
  const configure = () =>
    openConfigMenu(api, {
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

  try {
    // Primary path: keymap layer exposing slash commands + palette entries.
    api.keymap.registerLayer({
      commands: [
        {
          name: "ds.peak.configure",
          title: "DeepSeek Peak: configure time ranges",
          category: "Plugin",
          namespace: "palette",
          slashName: "dspeak",
          run: configure,
        },
        {
          name: "ds.peak.guard.confirm",
          title: "DeepSeek Peak: confirm peak prompt",
          category: "Plugin",
          namespace: "palette",
          slashName: "dspeak-confirm",
          run: confirmPeak,
        },
      ],
    })
  } catch {
    // Fallback path for older runtimes that lack keymap layers.
    if (api.command) {
      try {
        api.command.register(() => [
          {
            title: "DeepSeek Peak: configure time ranges",
            value: "ds.peak.configure",
            category: "Plugin",
            slash: { name: "dspeak" },
            onSelect: configure,
          },
          {
            title: "DeepSeek Peak: confirm peak prompt",
            value: "ds.peak.guard.confirm",
            category: "Plugin",
            slash: { name: "dspeak-confirm" },
            onSelect: confirmPeak,
          },
        ])
      } catch {
        // ignore command registration errors
      }
    }
  }
}

// Plugin module contract: `id` scopes KV keys; `tui` wires up the TUI.
const plugin: TuiPluginModule = {
  id: "ds-peak-warningx",
  tui,
}

export default plugin
