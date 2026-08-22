/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { migrateLegacyRanges, sanitizeRanges } from "./ranges.ts"
import { DEFAULT_RANGES, DEFAULT_SLOT_ORDER, KV_RANGES_KEY, WEEKDAY_DEFAULT_DAYS } from "./config.ts"
import type { DsPeakOptions, TimeRange } from "./types.ts"
import { openConfigMenu } from "./dialogs.tsx"
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

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as Partial<DsPeakOptions>
  const [ranges, setRanges] = createSignal<TimeRange[]>(loadRanges(api, opts))

  // Update in-memory state and persist to KV so edits survive restarts.
  const save = (next: TimeRange[]) => {
    setRanges(next)
    try {
      api.kv.set(KV_RANGES_KEY, next)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
  }

  const order = typeof opts.order === "number" ? opts.order : DEFAULT_SLOT_ORDER

  // Register every slot in ONE call — duplicate orders across separate
  // registrations are rejected by newer hosts, which would silently drop
  // one of the two slots.
  try {
    api.slots.register({
      order,
      slots: {
        // Render the pricing panel in the session sidebar.
        sidebar_content(ctx) {
          return <PeakPanel theme={ctx.theme.current} ranges={ranges} />
        },
        // Render the minimal PEAK/OFF-PEAK dot on the landing screen.
        home_prompt_right(ctx) {
          return <PeakHomeIndicator theme={ctx.theme.current} ranges={ranges} />
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
  const configure = () => openConfigMenu(api, ranges, save)

  let commandRegistered = false
  try {
    // Primary path: keymap layer exposing a slash command + palette entry.
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
      ],
    })
    commandRegistered = true
  } catch {
    commandRegistered = false
  }

  // Fallback path for older runtimes that lack keymap layers.
  if (!commandRegistered && api.command) {
    api.command.register(() => [
      {
        title: "DeepSeek Peak: configure time ranges",
        value: "ds.peak.configure",
        category: "Plugin",
        slash: { name: "dspeak" },
        onSelect: configure,
      },
    ])
  }
}

// Plugin module contract: `id` scopes KV keys; `tui` wires up the TUI.
const plugin: TuiPluginModule = {
  id: "ds-peak-warningx",
  tui,
}

export default plugin