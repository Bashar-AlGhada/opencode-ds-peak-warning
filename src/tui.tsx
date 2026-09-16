/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import {
  coerceCoverageDoc,
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
  DEFAULT_GUARD_COOLDOWN_MS,
  DEFAULT_GUARD_PROVIDERS,
  DEFAULT_RANGES,
  DEFAULT_SLOT_ORDER,
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_RANGES_KEY,
  KV_RUNS_KEY,
  WEEKDAY_DEFAULT_DAYS,
} from "./config.ts"
import type { DsPeakOptions, GuardSettings, TimeRange } from "./types.ts"
import { sanitizeGuardSettings } from "./guard.ts"
import { formatCooldown } from "./guard.ts"
import { formatLastActivity, installPromptGuard, type GuardActivity } from "./guard-intercept.ts"
import { parseConfigModel } from "./guard.ts"
import { openConfigMenu } from "./dialogs.tsx"
import { showPeakConfirmDialog } from "./guard-ui.tsx"
import { PeakPanel } from "./panel.tsx"
import { PeakHomeIndicator } from "./home.tsx"

/**
 * Resolve the effective peak windows. Each entry may carry a day-of-week
 * pattern. Precedence: saved KV value > plugin `ranges` option > built-in
 * weekday defaults.
 */
function resolveEffectiveRanges(api: TuiPluginApi, opts: Partial<DsPeakOptions>): TimeRange[] {
  try {
    // Prefer what the user last saved through /dspeak (day patterns included).
    const fromKv = api.kv.get<unknown>(KV_RANGES_KEY)
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
function loadCoverage(api: TuiPluginApi, opts: Partial<DsPeakOptions>): { doc: CoverageDoc; rebuilt: boolean } {
  try {
    const fromKv = api.kv.get<unknown>(KV_RUNS_KEY)
    const doc = coerceCoverageDoc(fromKv)
    if (doc) return { doc, rebuilt: false }
  } catch {
    // ignore kv read errors, rebuild below
  }
  return { doc: makeCoverageDoc(resolveEffectiveRanges(api, opts)), rebuilt: true }
}

/** Persist both the coverage doc and the legacy plain-array key (rollback safety). */
function persistCoverage(api: TuiPluginApi, doc: CoverageDoc): void {
  try {
    api.kv.set(KV_RUNS_KEY, doc)
  } catch {
    // kv may be unavailable; keep in-memory state
  }
  try {
    api.kv.set(KV_RANGES_KEY, doc.ranges)
  } catch {
    // kv may be unavailable; keep in-memory state
  }
}

function defaultGuard(): GuardSettings {
  return { enabled: false, mode: "block", cooldownMs: DEFAULT_GUARD_COOLDOWN_MS, providers: [...DEFAULT_GUARD_PROVIDERS] }
}

/** Precedence: saved KV value > plugin `guard` option > defaults (off). */
function loadGuard(api: TuiPluginApi, opts: Partial<DsPeakOptions>): GuardSettings {
  const fallback = sanitizeGuardSettings(opts.guard, defaultGuard())
  try {
    const fromKv = api.kv.get<unknown>(KV_GUARD_KEY)
    if (fromKv && typeof fromKv === "object") return sanitizeGuardSettings(fromKv, fallback)
  } catch {
    // ignore kv read errors
  }
  return fallback
}

function loadLastAck(api: TuiPluginApi): number {
  try {
    const v = api.kv.get<unknown>(KV_GUARD_ACK_KEY)
    if (typeof v === "number" && Number.isFinite(v) && v > 0) return Math.floor(v)
  } catch {
    // ignore kv read errors
  }
  return 0
}

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as Partial<DsPeakOptions>
  ensureClockRunning()
  const initial = loadCoverage(api, opts)
  if (initial.rebuilt) persistCoverage(api, initial.doc)
  // Single choke point for window state: every settings change flows through
  // `save`, which always rebuilds the merged coverage array with it — the
  // array cannot go stale relative to the settings.
  const [coverage, setCoverage] = createSignal<CoverageDoc>(initial.doc)
  const ranges = () => coverage().ranges
  const runs = () => coverage().runs
  const [guardSettings, setGuardSettings] = createSignal<GuardSettings>(loadGuard(api, opts))
  const [lastAck, setLastAck] = createSignal<number>(loadLastAck(api))
  const [activity, setActivity] = createSignal<GuardActivity | null>(null)
  const [guardInstalled, setGuardInstalled] = createSignal(false)

  // Update in-memory state and persist to KV so edits survive restarts.
  // Re-sanitizes defensively so even a hypothetical direct caller cannot
  // store ranges without a matching freshly-built array.
  const save = (next: TimeRange[]) => {
    // An explicitly emptied list means "no peak windows" (not "defaults").
    const doc = makeCoverageDoc(migrateLegacyRanges(sanitizeRanges(next), WEEKDAY_DEFAULT_DAYS))
    setCoverage(doc)
    persistCoverage(api, doc)
  }

  const saveGuard = (next: GuardSettings) => {
    setGuardSettings(next)
    try {
      api.kv.set(KV_GUARD_KEY, next)
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
      try {
        guard.ensurePatched()
      } catch {
        // ignore re-patch errors
      }
    })
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
  // plugins such as vim.
  try {
    api.slots.register({
      order,
      slots: {
        // Render the pricing panel in the session sidebar.
        sidebar_content(ctx) {
          return <PeakPanel theme={ctx.theme.current} ranges={ranges} runs={runs} guardLine={guardLine} />
        },
        // Render the minimal PEAK/OFF-PEAK dot on the landing screen.
        home_prompt_right(ctx) {
          return <PeakHomeIndicator theme={ctx.theme.current} ranges={ranges} runs={runs} />
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
    openConfigMenu(api, ranges, save, { settings: guardSettings, saveSettings: saveGuard, ack }, diagnosticLines)
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
