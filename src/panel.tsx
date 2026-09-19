/** @jsxImportSource @opentui/solid */
import type { TuiThemeCurrent } from "@opencode-ai/plugin/tui"
import { formatDays, formatMinutes } from "./ranges.ts"
import type { PeakRun } from "./ranges.ts"
import type { TimeRange } from "./types.ts"
import { formatTransitionAt, formatTransitionIn, timezoneCity, usePeakStatus } from "./status.ts"
import { PLUGIN_VERSION } from "./version.ts"

export interface PeakPanelProps {
  theme: TuiThemeCurrent
  ranges: () => TimeRange[]
  /** Prebuilt coverage array; hot status reads use it when provided. */
  runs?: () => PeakRun[]
  /** Guard status line, or null when the guard section should be hidden. */
  guardLine?: () => string | null
}

/** Sidebar panel sized for a narrow column: short lines, no overflowing rows. */
export function PeakPanel(props: PeakPanelProps) {  const { now, time, status, transition, local, tz } = usePeakStatus(props.ranges, props.runs)
  const peak = () => status().peak
  const city = timezoneCity(tz)

  // "01:00" today, or "Mon 01:00" when the flip lands on another day.
  const atLabel = () => formatTransitionAt(transition(), now())

  // Minutes until the next flip.
  const untilLabel = () => formatTransitionIn(transition(), now())

  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1}>
      <text fg={props.theme.text}>
        <b>DeepSeek Pricing</b>
      </text>
      {/* Status dot, amber when peak, green when off-peak, with the permanent
          freeze disclaimer (a view can paint stale data after sleep/stall) */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
        <span style={{ fg: props.theme.textMuted }}> (can freeze)</span>
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
      {/* Guard state + last outcome, so a silent fail-open is visible */}
      {(() => {
        const line = props.guardLine?.()
        return line ? <text fg={props.theme.textMuted}>{line}</text> : null
      })()}
      <text fg={props.theme.textMuted}>edit: /dspeak · v{PLUGIN_VERSION}</text>
    </box>
  )
}

/**
 * Compact sidebar block shown when the full panel is toggled off: just the
 * status dot with its freeze disclaimer plus the /dspeak entry line, so the
 * basics stay visible without the time/window details.
 */
export function PeakPanelMini(props: PeakPanelProps) {
  const { status } = usePeakStatus(props.ranges, props.runs)
  const peak = () => status().peak

  return (
    <box flexShrink={0} paddingTop={1} paddingBottom={1}>
      {/* Status dot, amber when peak, green when off-peak, with the permanent
          freeze disclaimer (a view can paint stale data after sleep/stall) */}
      <text fg={peak() ? props.theme.warning : props.theme.success}>
        {"\u25CF"} {peak() ? "PEAK" : "OFF-PEAK"}
        <span style={{ fg: props.theme.textMuted }}> (can freeze)</span>
      </text>
      <text fg={props.theme.textMuted}>edit: /dspeak · v{PLUGIN_VERSION}</text>
    </box>
  )
}