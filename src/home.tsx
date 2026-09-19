/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { TimeRange } from "./types.ts"
import type { PeakRun } from "./ranges.ts"
import { statusTone, toneColor, usePeakStatus } from "./status.ts"

export interface PeakHomeIndicatorProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; hot status reads use it when provided. */
  runs?: () => PeakRun[]
}

/** Minimal landing-screen indicator: colored dot + PEAK/OFF-PEAK label. */
export function PeakHomeIndicator(props: PeakHomeIndicatorProps) {
  const { now, status, transition } = usePeakStatus(props.ranges, props.runs)
  const peak = () => status().peak
  // Red while peak, green off-peak, yellow when peak starts within 30 min.
  const tone = () => toneColor(props.theme, statusTone(peak(), transition(), now()))

  return (
    <box paddingLeft={1} flexShrink={0}>
      {/* Same dot+label as the panel, kept short so it doesn't crowd the prompt row.
          The muted disclaimer stays on the line permanently: a view can paint
          stale data after sleep or a timer stall, so the status is guidance,
          not a billing guarantee. */}
      <text fg={tone()}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
        <span style={{ fg: props.theme.textMuted }}> (can freeze)</span>
      </text>
    </box>
  )
}