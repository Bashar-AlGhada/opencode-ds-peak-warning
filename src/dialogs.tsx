/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { formatDays, parseRange } from "./ranges.ts"
import { DEFAULT_RANGES } from "./config.ts"
import type { TimeRange } from "./types.ts"

/** Open the /dspeak config menu: add, remove, or reset peak windows. */
export function openConfigMenu(
  api: TuiPluginApi,
  ranges: () => TimeRange[],
  save: (next: TimeRange[]) => void,
) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="DeepSeek Peak - configure peak windows"
      placeholder="Choose an action"
      options={[
        { title: "Add a peak window", value: "add", onSelect: () => openAddRange(api, ranges, save) },
        { title: "Remove a peak window", value: "remove", onSelect: () => openRemoveRange(api, ranges, save) },
        { title: "Reset to DeepSeek defaults", value: "reset", onSelect: () => openReset(api, save) },
        { title: "Done", value: "done", onSelect: () => api.ui.dialog.clear() },
      ]}
    />
  ))
}

/** Prompt for a new window, validating input via parseRange before saving. */
export function openAddRange(
  api: TuiPluginApi,
  ranges: () => TimeRange[],
  save: (next: TimeRange[]) => void,
) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogPrompt
      title="Add a peak window (UTC)"
      description={() => (
        <text fg={api.theme.current.textMuted}>
          Format: HH:MM-HH:MM [days], e.g. 22:00-02:00 or 06:00-10:00 Mon-Fri
        </text>
      )}
      placeholder="e.g. 22:00-02:00 Sat,Sun"
      onCancel={() => api.ui.dialog.clear()}
      onConfirm={(value) => {
        const range = parseRange(value)
        if (!range) {
          api.ui.toast({ variant: "error", message: `Invalid range: ${value}` })
          return
        }
        save([...ranges(), range])
        api.ui.dialog.clear()
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
export function openRemoveRange(
  api: TuiPluginApi,
  ranges: () => TimeRange[],
  save: (next: TimeRange[]) => void,
) {
  api.ui.dialog.replace(() => (
    <api.ui.DialogSelect
      title="Remove a peak window"
      placeholder="Pick a window to remove"
      options={ranges().map((r, i) => ({
        title: `${r.start}-${r.end}${formatDays(r.days) ? ` ${formatDays(r.days)}` : ""}`,
        value: i,
        onSelect: () => {
          save(ranges().filter((_, j) => j !== i))
          api.ui.dialog.clear()
          api.ui.toast({ variant: "success", message: `Removed ${r.start}-${r.end}` })
        },
      }))}
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