/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { formatDays, parseRange } from "./ranges.ts"
import type { PeakRun } from "./ranges.ts"
import { DEFAULT_RANGES } from "./config.ts"
import { formatCooldown } from "./guard.ts"
import type { GuardSettings, TimeRange } from "./types.ts"
import { PeakDialogHeader } from "./header.tsx"

export interface GuardMenuSignals {
  settings: () => GuardSettings
  saveSettings: (next: GuardSettings) => void
  ack: (at?: number) => void
}

export interface PanelMenuSignals {
  visible: () => boolean
  save: (next: boolean) => void
}

/**
 * Everything the /dspeak dialogs need: live window/kv accessors plus the
 * optional submenus. Passed by reference so every dialog (re)opens against
 * current state and the status header recomputes on each open.
 */
export interface ConfigMenuCtx {
  ranges: () => TimeRange[]
  runs: () => PeakRun[]
  save: (next: TimeRange[]) => void
  guard?: GuardMenuSignals
  panel?: PanelMenuSignals
  diagnostics?: () => string[]
}

/** Open the /dspeak config menu: live status header, windows, panel, guard, diagnostics, reset. */
export function openConfigMenu(api: TuiPluginApi, ctx: ConfigMenuCtx) {
  const g = ctx.guard?.settings()
  const guardTitle = ctx.guard
    ? `Peak guard: ${g?.enabled ? `on (${g.mode}, ${formatCooldown(g.cooldownMs)})` : "off"}`
    : "Peak guard"
  const panel = ctx.panel
  const panelTitle = panel ? `Sidebar panel: ${panel.visible() ? "shown" : "hidden"}` : "Sidebar panel"
  const backHere = () => openConfigMenu(api, ctx)
  // The status header sits above the select list inside the dialog panel
  // (DialogSelect itself exposes no header prop). Both stay live: the
  // header follows the shared clock, the list rebuilds on every reopen.
  api.ui.dialog.replace(() => (
    <box flexDirection="column">
      <PeakDialogHeader theme={() => api.theme.current} ranges={ctx.ranges} runs={ctx.runs} />
      <api.ui.DialogSelect
        title="DeepSeek Peak - configure peak windows"
        placeholder="Choose an action"
        options={[
          { title: "Add a peak window", value: "add", onSelect: () => openAddRange(api, ctx) },
          { title: "Remove a peak window", value: "remove", onSelect: () => openRemoveRange(api, ctx) },
          ...(panel
            ? [
                {
                  title: panelTitle,
                  value: "panel",
                  description: "Full details, or a compact status line, in the session sidebar",
                  onSelect: () => {
                    const next = !panel.visible()
                    panel.save(next)
                    api.ui.toast({ variant: "info", message: `Sidebar panel ${next ? "shown" : "hidden"}` })
                    backHere()
                  },
                },
              ]
            : []),
          ...(ctx.guard
            ? [
                {
                  title: guardTitle,
                  value: "guard",
                  onSelect: () => openGuardMenu(api, ctx.guard!, backHere),
                },
              ]
            : []),
          ...(ctx.diagnostics
            ? [
                {
                  title: "Clock diagnostics",
                  value: "diag",
                  description: "Heartbeat, coverage size, event delivery counters",
                  onSelect: () => openDiagnostics(api, ctx.diagnostics!, backHere),
                },
              ]
            : []),
          { title: "Reset to DeepSeek defaults", value: "reset", onSelect: () => openReset(api, ctx.save) },
          { title: "Done", value: "done", onSelect: () => api.ui.dialog.clear() },
        ]}
      />
    </box>
  ))
}

/**
 * Read-only heartbeat snapshot: clock age, coverage size, event counters.
 * Uses DialogConfirm (plain-string message) instead of a disabled-option
 * select list: the host renders disabled select options as an empty list,
 * while the confirm message path is proven by the reset dialog.
 */
export function openDiagnostics(api: TuiPluginApi, diagnostics: () => string[], back: () => void) {
  let message: string
  try {
    message = diagnostics().join("\n")
  } catch {
    message = "Diagnostics unavailable."
  }
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="DeepSeek Peak - clock diagnostics"
      message={message}
      onConfirm={back}
      onCancel={back}
    />
  ))
}

/** Guard settings submenu (toggle, mode, cooldown, confirm-once). */
export function openGuardMenu(api: TuiPluginApi, guard: GuardMenuSignals, back: () => void) {
  const s = guard.settings()
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="DeepSeek Peak - prompt guard (DeepSeek only)"
      placeholder="Guard blocks prompts during peak until confirmed"
      options={[
        {
          title: s.enabled ? "Disable guard" : "Enable guard",
          value: "toggle",
          onSelect: () => {
            guard.saveSettings({ ...s, enabled: !s.enabled })
            api.ui.toast({ variant: "success", message: `Peak guard ${!s.enabled ? "enabled" : "disabled"}` })
            back()
          },
        },
        {
          title: `Mode: ${s.mode} (switch to ${s.mode === "block" ? "warn" : "block"})`,
          value: "mode",
          description: s.mode === "block" ? "Block asks for confirmation before sending" : "Warn only toasts after sending",
          onSelect: () => {
            guard.saveSettings({ ...s, mode: s.mode === "block" ? "warn" : "block" })
            back()
          },
        },
        {
          title: `Cooldown: ${formatCooldown(s.cooldownMs)}`,
          value: "cooldown",
          description: "How long one confirmation silences the guard",
          onSelect: () => openGuardCooldown(api, guard, back),
        },
        {
          title: "Confirm once now",
          value: "ack",
          description: "Acknowledge peak immediately (starts cooldown)",
          onSelect: () => {
            guard.ack(Date.now())
            api.ui.toast({ variant: "warning", message: "Peak acknowledged — prompts enabled" })
            api.ui.dialog.clear()
          },
        },
        { title: "Back", value: "back", onSelect: back },
      ]}
    />
  ))
}

/** Cooldown picker for the guard debounce. */
export function openGuardCooldown(api: TuiPluginApi, guard: GuardMenuSignals, back: () => void) {
  const s = guard.settings()
  const choices = [
    { title: "Every time (off)", value: 0 },
    { title: "1 minute", value: 60_000 },
    { title: "5 minutes", value: 5 * 60_000 },
    { title: "15 minutes", value: 15 * 60_000 },
    { title: "1 hour", value: 60 * 60_000 },
  ]
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<number>
      title="Guard confirmation cooldown"
      placeholder="How long one confirmation lasts"
      options={[
        ...choices.map((c) => ({
          title: `${c.title}${s.cooldownMs === c.value ? " (current)" : ""}`,
          value: c.value,
          onSelect: () => {
            guard.saveSettings({ ...s, cooldownMs: c.value })
            back()
          },
        })),
        { title: "Back", value: -1, onSelect: back },
      ]}
    />
  ))
}

/** Prompt for a new window, validating input via parseRange before saving. */
export function openAddRange(api: TuiPluginApi, ctx: ConfigMenuCtx) {
  const back = () => openConfigMenu(api, ctx)
  const { ranges, save } = ctx
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Add a peak window (UTC)"
      description={() => (
        <text fg={api.theme.current.textMuted}>
          Format: HH:MM-HH:MM [days], e.g. 22:00-02:00 or 06:00-10:00 Mon-Fri
        </text>
      )}
      placeholder="e.g. 22:00-02:00 Sat,Sun"
      onCancel={back}
      onConfirm={(value) => {
        const range = parseRange(value)
        if (!range) {
          api.ui.toast({ variant: "error", message: `Invalid range: ${value}` })
          return
        }
        save([...ranges(), range])
        back()
        const tag = formatDays(range.days)
        api.ui.toast({
          variant: "success",
          message: `Added ${range.start}-${range.end}${tag ? ` ${tag}` : ""}`,
        })
      }}
    />
  ))
}

/** Let the user pick an existing window to delete. */
export function openRemoveRange(api: TuiPluginApi, ctx: ConfigMenuCtx) {
  const back = () => openConfigMenu(api, ctx)
  const { ranges, save } = ctx
  const list = ranges()
  if (!list.length) {
    api.ui.toast({ variant: "info", message: "No peak windows to remove" })
    back()
    return
  }
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect<number>
      title="Remove a peak window"
      placeholder="Pick a window to remove"
      options={[
        ...list.map((r, i) => ({
          title: `${r.start}-${r.end}${formatDays(r.days) ? ` ${formatDays(r.days)}` : ""}`,
          value: i,
          onSelect: () => {
            save(list.filter((_, j) => j !== i))
            back()
            api.ui.toast({ variant: "success", message: `Removed ${r.start}-${r.end}` })
          },
        })),
        { title: "Back", value: -1, onSelect: back },
      ]}
    />
  ))
}

/** Confirm before restoring the DeepSeek default windows. */
export function openReset(api: TuiPluginApi, save: (next: TimeRange[]) => void) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogConfirm
      title="Reset to defaults"
      message="Restore DeepSeek defaults (weekday peak windows, weekends off-peak)?"
      onConfirm={() => {
        save(DEFAULT_RANGES.slice())
        api.ui.dialog.clear()
        api.ui.toast({ variant: "success", message: "Reset to DeepSeek defaults" })
      }}
      onCancel={() => api.ui.dialog.clear()}
    />
  ))
}
