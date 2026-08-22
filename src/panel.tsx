/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { formatDays, formatDuration, formatMinutes, utcMinutes } from "./ranges.ts"
import { DAY_LABELS } from "./config.ts"
import type { TimeRange } from "./types.ts"
import { usePeakStatus } from "./status.ts"

export interface PeakPanelProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
}

const MS_MIN = 60_000

/** Sidebar panel sized for a narrow column: short lines, no overflowing rows. */
export function PeakPanel(props: PeakPanelProps) {
  const { now, time, status, transition, local, tz } = usePeakStatus(props.ranges)
  const peak = () => status().peak

  // City-only timezone label ("Asia/Damascus" -> "Damascus").
  const city = tz.includes("/") ? tz.split("/").pop()!.replace(/_/g, " ") : tz

  // "01:00" today, or "Mon 01:00" when the flip lands on another day.
  const atLabel = () => {
    const at = transition().at
    const clock = formatMinutes(utcMinutes(at))
    return at.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
      ? clock
      : `${DAY_LABELS[at.getUTCDay()]} ${clock}`
  }

  // Minutes until the next flip (the scan aligns to whole minutes).
  const untilLabel = () => formatDuration(Math.round((transition().at.getTime() - now().getTime()) / MS_MIN))

  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1}>
      <text fg={props.theme.text}>
        <b>DeepSeek Pricing</b>
      </text>
      {/* Status dot, amber when peak, green when off-peak */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
      </text>
      <text fg={props.theme.textMuted}>
        UTC {formatMinutes(time())} · {formatMinutes(local())} {city}
      </text>
      {/* Next switch, day-of-week aware */}
      <text fg={props.theme.textMuted}>
        Next: {transition().to ? "peak" : "off-peak"} {atLabel()} UTC
      </text>
      {/* Its own countdown row */}
      <text fg={props.theme.textMuted}>in {untilLabel()}</text>
      <text fg={props.theme.textMuted}>Windows (UTC):</text>
      {/* One short row per window; the Next line above carries the countdown */}
      {props.ranges().map((r) => {
        const tag = formatDays(r.days)
        return (
          <text fg={props.theme.warning}>
            {r.start}-{r.end}
            {tag ? ` ${tag}` : ""}
          </text>
        )
      })}
      <text fg={props.theme.textMuted}>otherwise off-peak</text>
      <text fg={props.theme.textMuted}>edit: /dspeak</text>
    </box>
  )
}