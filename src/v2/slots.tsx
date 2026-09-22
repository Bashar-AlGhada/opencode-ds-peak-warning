/** @jsxImportSource @opentui/solid */
import { Show } from "solid-js"
import type { Context } from "@opencode/plugin/tui/context"
import type { PeakRun } from "../ranges.ts"
import type { TimeRange } from "../types.ts"
import type { SelectedModel } from "../provider.ts"
import { PeakHomeIndicator } from "../home.tsx"
import { PeakPanel, PeakPanelMini } from "../panel.tsx"
import { adaptV2Theme } from "./theme.ts"

import { registerV2Commands } from "./commands.ts"

export interface V2SlotState {
  ranges: () => TimeRange[]
  runs: () => PeakRun[]
  panelVisible: () => boolean
  statusVisible: (model: SelectedModel | undefined) => boolean
  guardLine: () => string | null
  commands: {
    configure: () => Promise<void>
    confirmPeak: () => void
  }
}

// OpenCode PR #50745 adds `model` to these slot inputs. Keep this boundary
// compatible with the published 2.0.14 declarations until that API is released;
// the host-supplied runtime field remains the only source of model identity.
type SlotModelInput = {
  readonly model?: SelectedModel
}

function selectedModelFromSlotInput(input: unknown): SelectedModel | undefined {
  if (!input || typeof input !== "object") return undefined
  return (input as SlotModelInput).model
}

/**
 * Claim the v2 slots, reusing the shared Solid views:
 * - sidebar panel -> `sidebar.content` (append; togglable full/mini)
 * - home status dot -> `home.footer.status` (append; v2 has no
 *   home_prompt_right equivalent — the footer status row is the documented
 *   place for status contributions)
 *
 * Returns an unsubscribe-all cleanup for the setup return.
 */
export function registerV2Slots(context: Context, state: V2SlotState): () => void {
  const disposers: Array<() => void> = []
  const claim = (dispose: () => void): void => {
    disposers.push(dispose)
  }

  try {
    claim(
      context.ui.slot({
        append: "sidebar.content",
        render: (input) => (
          <Show when={state.statusVisible(selectedModelFromSlotInput(input))}>
            <Show
              when={state.panelVisible()}
              fallback={<PeakPanelMini theme={adaptV2Theme(context.theme)} ranges={state.ranges} runs={state.runs} />}
            >
              <PeakPanel
                theme={adaptV2Theme(context.theme)}
                ranges={state.ranges}
                runs={state.runs}
                guardLine={state.guardLine}
              />
            </Show>
          </Show>
        ),
      }),
    )
  } catch {
    try {
      context.ui.toast.show({ variant: "error", title: "ds-peak-warningx", message: "Sidebar slot registration failed" })
    } catch {
      // ignore toast errors
    }
  }

  try {
    claim(
      context.ui.slot({
        append: "home.footer.status",
        render: (input) => (
          <Show when={state.statusVisible(selectedModelFromSlotInput(input))}>
            <PeakHomeIndicator theme={adaptV2Theme(context.theme)} ranges={state.ranges} runs={state.runs} />
          </Show>
        ),
      }),
    )
  } catch {
    // footer status unavailable; sidebar panel still works
  }

  try {
    claim(
      context.ui.slot({
        append: "prompt.footer.status",
        render: (input) => (
          <Show when={state.statusVisible(selectedModelFromSlotInput(input))}>
            <PeakHomeIndicator theme={adaptV2Theme(context.theme)} ranges={state.ranges} runs={state.runs} />
          </Show>
        ),
      }),
    )
  } catch {
    // prompt footer status unavailable; sidebar and home status still work
  }

  // Global command layer: registered from a component render (NOT from
  // setup) so the layer has an owning component — an ownerless layer never
  // becomes reachable. The `app` slot mounts for the whole TUI lifetime on
  // every route, so the commands stay live everywhere. Returns null: this
  // claim contributes commands, not visuals.
  try {
    claim(
      context.ui.slot({
        append: "app",
        render: () => {
          registerV2Commands(context, state.commands)
          return null
        },
      }),
    )
  } catch {
    // command layer unavailable; /dspeak reachable only via panel line
  }

  return () => {
    for (const dispose of disposers) {
      try {
        dispose()
      } catch {
        // ignore cleanup errors
      }
    }
  }
}
