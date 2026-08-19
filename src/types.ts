// A peak pricing window, expressed as UTC times. Off-peak is everything else.
export interface TimeRange {
  start: string
  end: string
}

// Plugin options that can be supplied via the [spec, options] tui.json entry.
export interface DsPeakOptions {
  ranges?: TimeRange[]
  order?: number
}