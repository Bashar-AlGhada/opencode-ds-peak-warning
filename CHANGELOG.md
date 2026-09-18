# Changelog

All notable changes to this project will be documented in this file.

## [1.3.1] - 2026-09-18

### Fixed

- Sidebar panel and home indicator now repaint live under npm installs. The
  package shipped raw `.tsx` source, but the packaged opencode CLI applies no
  Solid transform to external plugin modules, so slot content rendered its
  initial frame while signal updates never repainted — timers, events, and
  the guard all worked, only the display froze. `./tui` now resolves to
  precompiled `dist/` output (built via `npm run build`); under an npm
  install the host maps the bundle's bare `solid-js`/`@opentui/*` imports to
  its singletons (one reactive graph). Sanity checks enforce the packaging
  contract, and a headless liveness test (`npm run live`) proves a clock poke
  re-runs the panel's subscribers.
- Panel footer now shows the release version (`edit: /dspeak · v1.3.1`) so a
  running install can be told apart from a stale cached copy.

### Known limitations

- Local file installs (a `tui.json` entry pointing at a path inside this
  repo) stay static on hosts that map bare `@opentui/*` to their singletons
  while leaving bare `solid-js` on the non-reactive server build: the panel
  renders once and never repaints. Validate live behavior through the
  published package, not a file entry.

## [1.3.0] - 2026-09-16

### Added

- Merged coverage array: overlapping windows stay as entered in settings and
  are unioned into a sorted run list once per settings change (persisted with
  a fingerprint; any mismatch rebuilds instead of trusting stale data). Tick
  reads are now a binary search instead of a multi-day minute scan.
- Singleton clock with event fan-in over the entire `Event` union (all
  `session.*`, `tui.*`, `message.*`, generation, workspace, pty and misc
  lifecycle types) through a rate-limited `poke()`, plus a read-only `Clock
  diagnostics` row in `/dspeak` (clock age, tick/refresh counters, per-type
  delivery counts including silent types). A test enforces the subscription
  list against the SDK's generated types in both directions, so new upstream
  event types fail loudly instead of going unwatched.
- An explicitly emptied window list now persists as "no peak windows" across
  restarts instead of resurrecting the defaults.

### Fixed

- Stale-clock hardening: one shared clock per process (per-view timers can no
  longer diverge), self-sustaining fallback interval, and wake-from-sleep heal
  on first interaction.

## [1.2.0] - 2026-09-15

### Added

- Opt-in peak guard for DeepSeek prompts: asks for confirmation before a
  prompt goes out during peak hours. `block` mode opens a confirm dialog,
  `warn` mode sends normally with a warning toast. One confirmation silences
  the guard for a configurable cooldown (default 5 minutes, `0` asks every
  time). Manage it via `/dspeak` → `Peak guard`, pre-confirm any time with
  `/dspeak-confirm`, or set it in `tui.json` via the `guard` option. The
  sidebar panel shows a `Guard:` line with the current state and last outcome.
  Slash commands, shell mode, typing, and non-DeepSeek models are never
  blocked.

### Fixed

- Sidebar panel and home indicator no longer show stale data after long runs
  or PC sleep: the clock ticks aligned to each minute boundary, forces a
  refresh if a tick was missed, and refreshes on session activity.
