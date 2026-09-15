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
  // Opt-in peak guard: confirm before prompting on DeepSeek during peak.
  guard?: Partial<GuardSettings>
}

/** Peak-guard settings (all fields resolved with defaults at load). */
export interface GuardSettings {
  /** Master switch. Default false. */
  enabled: boolean
  /** "block" disables the prompt until confirmed; "warn" only toasts. */
  mode: "block" | "warn"
  /** Silence repeat confirms for this long after an ack. 0 = every time. */
  cooldownMs: number
  /** Provider/model substrings that the guard applies to (case-insensitive). */
  providers: string[]
}