import type { Context } from "@opencode/plugin/tui/context"

/**
 * Register the v2 keymap layer: palette + slash commands.
 *
 * MUST be called during a component render (the plugin calls it from an
 * `append: "app"` slot claim, exactly like the host's built-in diff viewer
 * registers its `/diff` command). The layer is owned by the calling
 * component: calling it from `setup()` leaves it ownerless (no keymap
 * provider above setup) and the commands never become reachable — no
 * palette entries, no slash completion. The reactive layer function keeps
 * the commands live for as long as the app slot stays mounted, which is
 * the whole TUI lifetime.
 */
export function registerV2Commands(
  context: Context,
  commands: {
    configure: () => Promise<void>
    confirmPeak: () => void
  },
): void {
  context.keymap.layer(() => ({
    mode: "global",
    commands: [
      {
        id: "ds.peak.configure",
        title: "DeepSeek Peak: configure time ranges",
        group: "Plugin",
        palette: true,
        slash: { name: "dspeak" },
        run: async () => {
          await commands.configure()
        },
      },
      {
        id: "ds.peak.guard.confirm",
        title: "DeepSeek Peak: confirm peak prompt",
        group: "Plugin",
        palette: true,
        slash: { name: "dspeak-confirm" },
        run: () => {
          commands.confirmPeak()
        },
      },
    ],
  }))
}
