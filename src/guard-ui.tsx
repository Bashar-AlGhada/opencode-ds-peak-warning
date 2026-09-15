/** @jsxImportSource @opentui/solid */
import type { TuiPluginApi } from "@opencode-ai/plugin/tui"
import { formatDuration } from "./ranges.ts"
import { confirmDialogCallbacks, createConfirmSettlement } from "./guard-intercept.ts"

/**
 * Peak confirm dialog as a promise. Resolves true on confirm, false on
 * cancel or when another dialog steals the stack (onClose). Resolves true
 * when dialogs are unavailable so a UI failure can never strand the user.
 */
export function showPeakConfirmDialog(api: TuiPluginApi, summary: string, cooldownMs: number): Promise<boolean> {
  const settle = createConfirmSettlement()
  const cooldownNote =
    cooldownMs > 0
      ? `Confirming silences this check for ${formatDuration(Math.round(cooldownMs / 60_000))}.`
      : "You will be asked again on every prompt."
  try {
    const cb = confirmDialogCallbacks(api, settle)
    api.ui.dialog.replace(
      () => (
        <api.ui.DialogConfirm
          title="DeepSeek peak pricing"
          message={`Peak rates apply (${summary}). Send anyway? ${cooldownNote}`}
          onConfirm={cb.onConfirm}
          onCancel={cb.onCancel}
        />
      ),
      cb.onClose,
    )
  } catch {
    settle.done(true)
  }
  return settle.promise
}
