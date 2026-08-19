/** @jsxImportSource @opentui/solid */
import { createSignal } from "solid-js"
import type { TuiPlugin, TuiPluginApi, TuiPluginModule } from "@opencode-ai/plugin/tui"
import { DEFAULT_RANGES, sanitizeRanges } from "./ranges"
import type { DsPeakOptions, TimeRange } from "./types"
import { openConfigMenu } from "./dialogs"
import { PeakPanel } from "./panel"
import { PeakHomeIndicator } from "./home"

// KV key where user-edited peak windows are persisted.
const KV_RANGES = "ds-peak:ranges"
// Default slot ordering (slots are rendered lowest-first).
const DEFAULT_ORDER = 150

/**
 * Resolve the effective peak windows. Precedence:
 * saved KV value > plugin `ranges` option > built-in defaults.
 */
function loadRanges(api: TuiPluginApi, opts: Partial<DsPeakOptions>): TimeRange[] {
  try {
    // Prefer what the user last saved through /dspeak.
    const fromKv = api.kv.get<unknown>(KV_RANGES)
    if (Array.isArray(fromKv)) {
      const cleaned = sanitizeRanges(fromKv)
      if (cleaned.length) return cleaned
    }
  } catch {
    // ignore kv read errors, fall through
  }
  const fromOpts = opts.ranges
  if (Array.isArray(fromOpts) && fromOpts.length) {
    const cleaned = sanitizeRanges(fromOpts)
    if (cleaned.length) return cleaned
  }
  return DEFAULT_RANGES.slice()
}

const tui: TuiPlugin = async (api, options) => {
  const opts = (options ?? {}) as Partial<DsPeakOptions>
  const [ranges, setRanges] = createSignal<TimeRange[]>(loadRanges(api, opts))

  // Update in-memory state and persist to KV so edits survive restarts.
  const save = (next: TimeRange[]) => {
    setRanges(next)
    try {
      api.kv.set(KV_RANGES, next)
    } catch {
      // kv may be unavailable; keep in-memory state
    }
  }

  const order = typeof opts.order === "number" ? opts.order : DEFAULT_ORDER

  // Render the pricing panel in the session sidebar.
  try {
    api.slots.register({
      order,
      slots: {
        sidebar_content(ctx) {
          return <PeakPanel theme={ctx.theme.current} ranges={ranges} />
        },
      },
    })
  } catch (err) {
    api.ui.toast({
      variant: "error",
      title: "ds-peak-warning",
      message: `Sidebar slot registration failed: ${(err as Error).message}`,
    })
  }

  // Render the minimal PEAK/OFF-PEAK dot on the landing screen.
  try {
    api.slots.register({
      order,
      slots: {
        home_prompt_right(ctx) {
          return <PeakHomeIndicator theme={ctx.theme.current} ranges={ranges} />
        },
      },
    })
  } catch (err) {
    api.ui.toast({
      variant: "error",
      title: "ds-peak-warning",
      message: `Home indicator slot registration failed: ${(err as Error).message}`,
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
  id: "ds-peak-warning",
  tui,
}

export default plugin