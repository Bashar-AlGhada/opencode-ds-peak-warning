/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { formatDays, formatDuration, formatMinutes, nextOccurrence, utcMinutes } from "./ranges.ts"
import { DAY_LABELS } from "./config.ts"
import type { TimeRange } from "./types.ts"
import { usePeakStatus } from "./status.ts"

export interface PeakPanelProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
}

/** Sidebar panel shown inside a session: status, times, next transition, and per-window countdowns. */
export function PeakPanel(props: PeakPanelProps) {
  const { now, time, status, transition, local, tz } = usePeakStatus(props.ranges)
  const peak = () => status().peak

  // "04:00 UTC" today, or "01:00 UTC Mon" when the flip is on another day.
  const atLabel = () => {
    const at = transition().at
    const clock = `${formatMinutes(utcMinutes(at))} UTC`
    return at.toISOString().slice(0, 10) === new Date().toISOString().slice(0, 10)
      ? clock
      : `${clock} ${DAY_LABELS[at.getUTCDay()]}`
  }

  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1}>
      <text fg={props.theme.text}>
        <b>DeepSeek Pricing</b>      <text fg={props.theme.textMuted}>Edit: /dspeak</text>
      </text>
      {/* Current status dot, colored amber when peak, green when off-peak */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
      </text>
      {/* Current UTC + local time with the detected timezone */}
      <text fg={props.theme.textMuted}>
        UTC {formatMinutes(time())} · {formatMinutes(local())} {tz}
      </text>
      {/* When the next peak/off-peak switch happens (day-of-week aware) */}
      <text fg={props.theme.textMuted}>
        Next: {transition().to ? "peak" : "off-peak"} at {atLabel()}
      </text>
      {/* Every window with its day pattern and real next occurrence */}
      <text fg={props.theme.textMuted}>Peak windows (UTC):</text>
      {props.ranges().map((r) => {
        const occ = nextOccurrence(r, now())
        const tag = formatDays(r.days)
        const suffix = occ.active
          ? "(active)"
          : occ.daysAway > 0
            ? `(in ${formatDuration(occ.minutes)}, ${DAY_LABELS[(now().getUTCDay() + occ.daysAway) % 7]})`
            : `(in ${formatDuration(occ.minutes)})`
        return (
          <text fg={props.theme.warning}>
            {r.start}-{r.end}
            {tag ? ` ${tag}` : ""} {suffix}
          </text>
        )
      })}

    </box>
  )
}