// Test-only Bun plugin: remaps bare "solid-js" imports to the reactive client
// build. Without this, Bun resolves the non-reactive server build and every
// signal/memo/effect in the tested code is statically dead — the exact split
// that froze the panel in hosts which map @opentui/* but not solid-js. The
// host's production mapping provides live singletons instead; this plugin is
// the headless-test equivalent. Must be imported (and awaited) before any
// module that (transitively) imports bare "solid-js".
import * as client from "solid-js/dist/solid.js"

await Bun.plugin({
  name: "solid-client-only",
  setup(build) {
    build.module("solid-js", () => ({ loader: "object", exports: { ...client } }))
  },
})
