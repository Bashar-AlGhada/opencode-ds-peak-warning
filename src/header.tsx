/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { formatDays, formatMinutes } from "./ranges.ts"
import type { PeakRun } from "./ranges.ts"
import type { TimeRange } from "./types.ts"
import { formatTransitionAt, formatTransitionIn, timezoneCity, usePeakStatus } from "./status.ts"

export interface PeakDialogHeaderProps {
  theme: () => TuiThemeCurrent
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; hot status reads use it when provided. */
  runs?: () => PeakRun[]
}

/**
 * Live status header for the top of the /dspeak settings dialog. Shows the
 * same pricing data as the sidebar panel (status, UTC + local time, next
 * switch with countdown, peak windows) but is never persisted anywhere: it
 * recomputes on every open through usePeakStatus and follows the shared
 * clock exactly like the panel does, so it stays fresh while the dialog is
 * open and costs nothing once it closes.
 */
export function PeakDialogHeader(props: PeakDialogHeaderProps) {
  const { now, time, status, transition, local, tz } = usePeakStatus(props.ranges, props.runs)
  const peak = () => status().peak
  const city = timezoneCity(tz)

  // Compact windows line (the panel uses one row per window; the dialog is
  // 60 wide, so a single joined line fits without overflowing).
  const windowsLine = () => {
    const list = props.ranges()
    if (!list.length) return "Windows: none (all off-peak)"
    return `Windows (UTC): ${list
      .map((r) => {
        const tag = formatDays(r.days)
        return `${r.start}-${r.end}${tag ? ` ${tag}` : ""}`
      })
      .join(", ")}`
  }

  return (
    <box flexDirection="column" paddingLeft={4} paddingRight={4} paddingBottom={1}>
      {/* Status dot, amber when peak, green when off-peak */}
      <text fg={peak() ? props.theme().warning : props.theme().success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
      </text>
      <text fg={props.theme().textMuted}>
        UTC {formatMinutes(time())} · {formatMinutes(local())} {city}
      </text>
      {/* Next switch, day-of-week aware, with its own countdown */}
      <text fg={props.theme().textMuted}>
        Next: {transition().to ? "peak" : "off-peak"} {formatTransitionAt(transition(), now())} UTC · in{" "}
        {formatTransitionIn(transition(), now())}
      </text>
      <text fg={props.theme().textMuted}>{windowsLine()}</text>
    </box>
  )
}
