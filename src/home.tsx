/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import type { TimeRange } from "./types.ts"
import type { PeakRun } from "./ranges.ts"
import { usePeakStatus } from "./status.ts"

export interface PeakHomeIndicatorProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; hot status reads use it when provided. */
  runs?: () => PeakRun[]
}

/** Minimal landing-screen indicator: just a colored dot + PEAK/OFF-PEAK label. */
export function PeakHomeIndicator(props: PeakHomeIndicatorProps) {
  const { status } = usePeakStatus(props.ranges, props.runs)
  const peak = () => status().peak

  return (
    <box paddingLeft={1} flexShrink={0}>
      {/* Same dot+label as the panel, kept short so it doesn't crowd the prompt row */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
      </text>
    </box>
  )
}