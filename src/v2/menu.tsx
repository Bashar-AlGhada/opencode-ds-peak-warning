/** @jsxImportSource @opentui/solid */
import { onMount } from "solid-js"
import { useKeyboard } from "@opentui/solid"
import type { KeyEvent, SelectRenderable } from "@opentui/core"
import { PeakDialogHeader } from "../header.tsx"
import type { PeakThemeColors } from "../status.ts"
import type { PeakRun } from "../ranges.ts"
import type { TimeRange } from "../types.ts"

export interface V2MenuItem {
  key: string
  title: string
  description?: string
}

export interface V2ConfigMenuProps {
  theme: () => PeakThemeColors
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; hot status reads use it when provided. */
  runs?: () => PeakRun[]
  items: readonly V2MenuItem[]
  onPick: (key: string) => void
  onCancel: () => void
}

/**
 * v2 /dspeak main menu: the SAME live PeakDialogHeader v1 renders (colored
 * status dot, UTC + local time, next switch with countdown, windows line)
 * above a native keyboard-driven select list (up/down/j/k + enter, with
 * descriptions — the same widget family the host builds its own selects
 * from).
 *
 * The v2 promise `dialog.select()` renders a bare host-styled list with no
 * header slot, so the main round goes through `dialog.show()` with this
 * component instead. Leaf submenus (guard, add/remove, reset, diagnostics)
 * stay promise-based, matching v1's host-dialog leaves.
 */
export function V2ConfigMenu(props: V2ConfigMenuProps) {
  let list: SelectRenderable | undefined
  // Belt and braces: the `focused` prop focuses during initial mount, and
  // this re-focuses once the node is attached to the dialog overlay.
  onMount(() => {
    try {
      list?.focus()
    } catch {
      // focus already held; selection still works
    }
  })
  // The native select owns up/down/enter; escape has no select binding, so
  // close the menu explicitly (mirrors dismissing the v1 dialog).
  useKeyboard((key: KeyEvent) => {
    if (key.name === "escape") {
      key.preventDefault()
      props.onCancel()
    }
  })

  return (
    <box flexDirection="column">
      <PeakDialogHeader theme={props.theme} ranges={props.ranges} runs={props.runs} />
      <box paddingLeft={4} paddingRight={4} paddingBottom={1}>
        <text fg={props.theme().text}>DeepSeek Peak - configure peak windows</text>
      </box>
      {/* Explicit height: the select has no intrinsic content size, so an
          auto-height column box collapses it to 0 rows (its render loop
          breaks out immediately when height is 0). One row per item takes
          2 lines with descriptions shown (itemSpacing defaults to 0). */}
      <select
        ref={list}
        focused
        height={props.items.length * 2}
        flexShrink={0}
        options={props.items.map((item) => ({
          name: item.title,
          description: item.description ?? "",
          value: item.key,
        }))}
        showDescription
        onSelect={(_index, option) => {
          const key = option?.value
          if (typeof key === "string") props.onPick(key)
        }}
      />
      <box paddingLeft={4} paddingRight={4} paddingTop={1}>
        <text fg={props.theme().textMuted}>↑↓ navigate · enter select · esc close</text>
      </box>
    </box>
  )
}
