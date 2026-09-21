import type { TuiPluginModule } from "@opencode-ai/plugin/tui"
import tuiModule from "./tui.tsx"
import { v2plugin } from "./v2/tui-v2.ts"

// Dual-generation plugin module, one codebase for both hosts:
// - opencode v1 reads `{ id, tui }` and ignores `setup` (requires v1 >= 1.18.29
//   for object-form entrypoints).
// - opencode v2 reads `{ id, setup }` and ignores `tui`.
// The v2 definition is hand-written (no Plugin.define value import): only
// `import type` references the v2 package, so nothing here executes an import
// a v1 host cannot resolve. Pure pricing logic is shared; only the host-API
// layer differs per generation.
const plugin = { tui: tuiModule.tui, ...v2plugin }

export default plugin satisfies TuiPluginModule
