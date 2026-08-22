// A peak pricing window, expressed as UTC times. Off-peak is everything else.
// Optionally restricted to specific weekdays (Beijing calendar day):
// days are indexed 0=Sunday .. 6=Saturday; omit for "every day".
export interface TimeRange {
  start: string
  end: string
  days?: number[]
}

// Plugin options that can be supplied via the [spec, options] tui.json entry.
export interface DsPeakOptions {
  // Peak windows overriding the defaults; each may carry a `days` pattern.
  ranges?: TimeRange[]
  order?: number
}