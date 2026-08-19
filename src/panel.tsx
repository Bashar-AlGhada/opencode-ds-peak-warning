/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { formatDuration, formatMinutes, minutesUntilStart } from "./ranges"
import type { TimeRange } from "./types"
import { usePeakStatus } from "./status"

export interface PeakPanelProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
}

/** Sidebar panel shown inside a session: status, times, next transition, and per-window countdowns. */
export function PeakPanel(props: PeakPanelProps) {
  const { time, status, transition, local, tz } = usePeakStatus(props.ranges)
  const peak = () => status().peak

  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1}>
      <text fg={props.theme.text}>
        <b>DeepSeek Pricing</b>
      </text>
      {/* Current status dot, colored amber when peak, green when off-peak */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
      </text>
      {/* Current UTC + local time with the detected timezone */}
      <text fg={props.theme.textMuted}>
        UTC {formatMinutes(time())} · {formatMinutes(local())} {tz}
      </text>
      {/* When the next peak/off-peak switch happens */}
      <text fg={props.theme.textMuted}>
        Next: {transition().to ? "peak" : "off-peak"} at {formatMinutes(transition().at)} UTC
      </text>
      <text fg={props.theme.textMuted}>Peak windows (UTC):</text>
      {/* Each window with its countdown: "(active)" or "(in 5h 20m)" */}
      {props.ranges().map((r) => {
        const next = minutesUntilStart(r, time())
        const suffix = next.active ? "(active)" : `(in ${formatDuration(next.minutes)})`
        return (
          <text fg={props.theme.warning}>
            {r.start}-{r.end} {suffix}
          </text>
        )
      })}
      <text fg={props.theme.textMuted}>(all other hours off-peak)</text>
      <text fg={props.theme.textMuted}>Edit: /dspeak</text>
    </box>
  )
}