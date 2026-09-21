/** @jsxImportSource @opentui/solid */
import type { Context } from "@opencode/plugin/tui/context"
import { formatDays, parseRange } from "../ranges.ts"
import { DEFAULT_RANGES } from "../config.ts"
import { formatCooldown } from "../guard.ts"
import type { GuardSettings, TimeRange } from "../types.ts"
import type { PeakThemeColors } from "../status.ts"
import { V2ConfigMenu } from "./menu.tsx"
import type { V2MenuItem } from "./menu.tsx"

type V2Dialog = Context["ui"]["dialog"]
type V2Toast = Context["ui"]["toast"]

export interface V2GuardMenu {
  settings: () => GuardSettings
  saveSettings: (next: GuardSettings) => void
  ack: (at?: number) => void
}

export interface V2PanelMenu {
  visible: () => boolean
  save: (next: boolean) => void
}

/**
 * Everything the v2 /dspeak menus need: live window accessors plus the
 * optional submenus, theme for the shared dialog header, and host
 * dialog/toast handles. Passed by reference so every menu round re-reads
 * current state.
 */
export interface V2MenuCtx {
  dialog: V2Dialog
  toast: V2Toast
  theme: () => PeakThemeColors
  ranges: () => TimeRange[]
  runs: () => import("../ranges.ts").PeakRun[]
  save: (next: TimeRange[]) => void
  guard?: V2GuardMenu
  panel?: V2PanelMenu
  diagnostics?: () => string[]
}

function toast(ctx: V2MenuCtx, message: string, variant: "info" | "success" | "warning" | "error" = "info"): void {
  try {
    ctx.toast.show({ message, variant })
  } catch {
    // ignore toast errors
  }
}

type MainChoice =
  | "add"
  | "remove"
  | "panel"
  | "guard"
  | "diag"
  | "reset"
  | "done"

/**
 * Main round of the v2 /dspeak menu. Rendered via `dialog.show()` with the
 * shared PeakDialogHeader (the same live, colored status header v1 shows:
 * status dot, UTC + local time, next switch with countdown, windows line)
 * above a native keyboard-driven select list. The promise
 * `dialog.select()` has no header slot, so it cannot carry that depth —
 * leaf submenus below stay promise-based, matching v1's host-dialog leaves.
 */
function showMainMenuV2(ctx: V2MenuCtx): Promise<MainChoice | undefined> {
  const g = ctx.guard?.settings()
  const guardLabel = ctx.guard ? `Peak guard: ${g?.enabled ? `on (${g.mode}, ${formatCooldown(g.cooldownMs)})` : "off"}` : "Peak guard"
  const panelLabel = ctx.panel ? `Sidebar panel: ${ctx.panel.visible() ? "shown" : "hidden"}` : "Sidebar panel"
  const items: V2MenuItem[] = [
    { key: "add", title: "Add a peak window", description: "Hours in UTC, e.g. 22:00-02:00 Sat,Sun" },
    { key: "remove", title: "Remove a peak window", description: "Pick one of the configured windows" },
    ...(ctx.panel
      ? [{ key: "panel", title: panelLabel, description: "Full details, or a compact status line, in the session sidebar" }]
      : []),
    ...(ctx.guard
      ? [{ key: "guard", title: guardLabel, description: "Block or warn on prompts sent during peak" }]
      : []),
    ...(ctx.diagnostics
      ? [{ key: "diag", title: "Clock diagnostics", description: "Heartbeat, coverage size, event delivery counters" }]
      : []),
    { key: "reset", title: "Reset to DeepSeek defaults", description: "Weekday peak windows, weekends off-peak" },
    { key: "done", title: "Done" },
  ]
  return new Promise((resolve) => {
    let done = false
    const finish = (choice: MainChoice | undefined) => {
      if (done) return
      done = true
      try {
        ctx.dialog.clear()
      } catch {
        // dialog already closed
      }
      resolve(choice)
    }
    try {
      ctx.dialog.show(
        () => (
          <V2ConfigMenu
            theme={ctx.theme}
            ranges={ctx.ranges}
            runs={ctx.runs}
            items={items}
            onPick={(key) => finish(key as MainChoice)}
            onCancel={() => finish(undefined)}
          />
        ),
        () => finish(undefined),
      )
    } catch {
      finish(undefined)
    }
  })
}

/** v2 /dspeak config menu: JSX main round, promise-dialog submenus. */
export async function openConfigMenuV2(ctx: V2MenuCtx): Promise<void> {
  for (;;) {
    let choice: MainChoice | undefined
    try {
      choice = await showMainMenuV2(ctx)
    } catch {
      return // dialog unavailable; bail out quietly
    }
    if (choice === undefined || choice === "done") return
    if (choice === "add") {
      await addRangeV2(ctx)
    } else if (choice === "remove") {
      await removeRangeV2(ctx)
    } else if (choice === "panel" && ctx.panel) {
      const next = !ctx.panel.visible()
      ctx.panel.save(next)
      toast(ctx, `Sidebar panel ${next ? "shown" : "hidden"}`)
    } else if (choice === "guard" && ctx.guard) {
      await guardMenuV2(ctx, ctx.guard)
    } else if (choice === "diag" && ctx.diagnostics) {
      await diagnosticsV2(ctx, ctx.diagnostics)
    } else if (choice === "reset") {
      await resetV2(ctx)
    }
  }
}

/** Read-only heartbeat snapshot via an alert dialog (multi-line message path). */
async function diagnosticsV2(ctx: V2MenuCtx, diagnostics: () => string[]): Promise<void> {
  let message: string
  try {
    message = diagnostics().join("\n")
  } catch {
    message = "Diagnostics unavailable."
  }
  try {
    await ctx.dialog.alert({ title: "DeepSeek Peak - clock diagnostics", message })
  } catch {
    // ignore dialog errors
  }
}

/** Guard settings submenu (toggle, mode, cooldown, confirm-once). */
async function guardMenuV2(ctx: V2MenuCtx, guard: V2GuardMenu): Promise<void> {
  for (;;) {
    const s = guard.settings()
    let choice: "toggle" | "mode" | "cooldown" | "ack" | "back" | undefined
    try {
      choice = await ctx.dialog.select({
        title: "DeepSeek Peak - prompt guard (DeepSeek only)",
        placeholder: "Guard blocks prompts during peak until confirmed",
        options: [
          { title: s.enabled ? "Disable guard" : "Enable guard", value: "toggle" as const },
          {
            title: `Mode: ${s.mode} (switch to ${s.mode === "block" ? "warn" : "block"})`,
            value: "mode" as const,
            description: s.mode === "block" ? "Block asks for confirmation before sending" : "Warn only toasts after sending",
          },
          {
            title: `Cooldown: ${formatCooldown(s.cooldownMs)}`,
            value: "cooldown" as const,
            description: "How long one confirmation silences the guard",
          },
          {
            title: "Confirm once now",
            value: "ack" as const,
            description: "Acknowledge peak immediately (starts cooldown)",
          },
          { title: "Back", value: "back" as const },
        ],
      })
    } catch {
      return
    }
    if (choice === undefined || choice === "back") return
    if (choice === "toggle") {
      guard.saveSettings({ ...s, enabled: !s.enabled })
      toast(ctx, `Peak guard ${!s.enabled ? "enabled" : "disabled"}`, "success")
    } else if (choice === "mode") {
      guard.saveSettings({ ...s, mode: s.mode === "block" ? "warn" : "block" })
    } else if (choice === "cooldown") {
      await guardCooldownV2(ctx, guard)
    } else if (choice === "ack") {
      guard.ack(Date.now())
      toast(ctx, "Peak acknowledged — prompts enabled", "warning")
      return
    }
  }
}

/** Cooldown picker for the guard debounce. */
async function guardCooldownV2(ctx: V2MenuCtx, guard: V2GuardMenu): Promise<void> {
  const s = guard.settings()
  const choices = [
    { title: "Every time (off)", value: 0 },
    { title: "1 minute", value: 60_000 },
    { title: "5 minutes", value: 5 * 60_000 },
    { title: "15 minutes", value: 15 * 60_000 },
    { title: "1 hour", value: 60 * 60_000 },
  ]
  let picked: number | undefined
  try {
    picked = await ctx.dialog.select<number>({
      title: "Guard confirmation cooldown",
      placeholder: "How long one confirmation lasts",
      options: [
        ...choices.map((c) => ({
          title: `${c.title}${s.cooldownMs === c.value ? " (current)" : ""}`,
          value: c.value,
        })),
        { title: "Back", value: -1 },
      ],
    })
  } catch {
    return
  }
  if (picked === undefined || picked < 0) return
  guard.saveSettings({ ...s, cooldownMs: picked })
}

/** Prompt for a new window, validating input via parseRange before saving. */
async function addRangeV2(ctx: V2MenuCtx): Promise<void> {
  let value: string | undefined
  try {
    value = await ctx.dialog.prompt({
      title: "Add a peak window (UTC)",
      description: "Format: HH:MM-HH:MM [days], e.g. 22:00-02:00 or 06:00-10:00 Mon-Fri",
      placeholder: "e.g. 22:00-02:00 Sat,Sun",
    })
  } catch {
    return
  }
  if (!value) return
  const range = parseRange(value)
  if (!range) {
    toast(ctx, `Invalid range: ${value}`, "error")
    return
  }
  ctx.save([...ctx.ranges(), range])
  const tag = formatDays(range.days)
  toast(ctx, `Added ${range.start}-${range.end}${tag ? ` ${tag}` : ""}`, "success")
}

/** Let the user pick an existing window to delete. */
async function removeRangeV2(ctx: V2MenuCtx): Promise<void> {
  const list = ctx.ranges()
  if (!list.length) {
    toast(ctx, "No peak windows to remove")
    return
  }
  let picked: number | undefined
  try {
    picked = await ctx.dialog.select<number>({
      title: "Remove a peak window",
      placeholder: "Pick a window to remove",
      options: [
        ...list.map((r, i) => ({
          title: `${r.start}-${r.end}${formatDays(r.days) ? ` ${formatDays(r.days)}` : ""}`,
          value: i,
        })),
        { title: "Back", value: -1 },
      ],
    })
  } catch {
    return
  }
  if (picked === undefined || picked < 0 || picked >= list.length) return
  const removed = list[picked]
  ctx.save(list.filter((_, j) => j !== picked))
  toast(ctx, `Removed ${removed.start}-${removed.end}`, "success")
}

/** Confirm before restoring the DeepSeek default windows. */
async function resetV2(ctx: V2MenuCtx): Promise<void> {
  let ok: boolean | undefined
  try {
    ok = await ctx.dialog.confirm({
      title: "Reset to defaults",
      message: "Restore DeepSeek defaults (weekday peak windows, weekends off-peak)?",
      label: { confirm: "Reset", cancel: "Cancel" },
    })
  } catch {
    return
  }
  if (ok !== true) return
  ctx.save(DEFAULT_RANGES.slice())
  toast(ctx, "Reset to DeepSeek defaults", "success")
}
