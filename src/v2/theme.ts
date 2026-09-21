import type { Context } from "@opencode/plugin/tui/context"
import type { PeakThemeColors } from "../status.ts"

/**
 * Map v2 nested `ResolvedTheme` tokens onto the flat color surface the
 * shared status views consume. Approximate mapping (v2 has no `accent`
 * token and no flat error/warning/success aliases):
 * - text / textMuted -> text.base / text.muted
 * - error / warning / success -> text.feedback.{error,warning,success}.base
 * (feedback red/yellow/green, the same semantic roles as v1)
 */
export function adaptV2Theme(theme: Context["theme"]): PeakThemeColors {
  return {
    text: theme.text.base,
    textMuted: theme.text.muted,
    error: theme.text.feedback.error.base,
    warning: theme.text.feedback.warning.base,
    success: theme.text.feedback.success.base,
  }
}
