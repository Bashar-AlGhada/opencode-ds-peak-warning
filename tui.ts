// v2 (opencode 2.x) directory-install entrypoint.
//
// The v2 host resolves a local directory spec to `<dir>/tui` (it does NOT
// consult package.json `exports` for directory targets — that mapping only
// applies to npm package specs). Without this file a `file:///...` directory
// entry in cli.json resolves to nothing and the plugin silently never loads.
// npm consumers are unaffected: `exports["./tui"]` still points at
// `./src/index.tsx` directly.
export { default } from "./src/index.tsx"
