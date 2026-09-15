/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { migrateLegacyRanges, sanitizeRanges } from "./ranges.ts"
import {
  DEFAULT_GUARD_COOLDOWN_MS,
  DEFAULT_GUARD_PROVIDERS,
  DEFAULT_RANGES,
  DEFAULT_SLOT_ORDER,
  KV_GUARD_ACK_KEY,
  KV_GUARD_KEY,
  KV_RANGES_KEY,
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
function loadRanges(api: TuiPluginApi, opts: Partial<DsPeakOptions>): TimeRange[] {
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
  const [ranges, setRanges] = createSignal<TimeRange[]>(loadRanges(api, opts))
  const [guardSettings, setGuardSettings] = createSignal<GuardSettings>(loadGuard(api, opts))
  const [lastAck, setLastAck] = createSignal<number>(loadLastAck(api))
  const [activity, setActivity] = createSignal<GuardActivity | null>(null)
  const [guardInstalled, setGuardInstalled] = createSignal(false)

  // Update in-memory state and persist to KV so edits survive restarts.
  const save = (next: TimeRange[]) => {
    setRanges(next)
    try {
      api.kv.set(KV_RANGES_KEY, next)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
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

  // Activity refresh for the ticking clocks and the client patch: user and
  // session events force an immediate clock read (wake-from-sleep heals on
  // first interaction) and re-apply the patch if the client rotated.
  const subscribeToActivity = (cb: () => void) => {
    const unsubs: Array<() => void> = []
    const types = [
      "session.updated",
      "session.idle",
      "session.status",
      "session.created",
      "tui.prompt.append",
      "tui.command.execute",
    ]
    for (const t of types) {
      try {
        unsubs.push(api.event.on(t as never, () => cb()))
      } catch {
        // unknown event type on this host; skip
      }
    }
    try {
      unsubs.push(
        api.event.on("session.updated" as never, () => {
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
    return () => {
      for (const u of unsubs) {
        try {
          u()
        } catch {
          // ignore cleanup errors
        }
      }
    }
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
          return <PeakPanel theme={ctx.theme.current} ranges={ranges} subscribe={subscribeToActivity} guardLine={guardLine} />
        },
        // Render the minimal PEAK/OFF-PEAK dot on the landing screen.
        home_prompt_right(ctx) {
          return <PeakHomeIndicator theme={ctx.theme.current} ranges={ranges} subscribe={subscribeToActivity} />
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
  const configure = () => openConfigMenu(api, ranges, save, { settings: guardSettings, saveSettings: saveGuard, ack })
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
