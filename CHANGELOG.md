# Changelog

All notable changes to this project will be documented in this file.

## [1.3.2] - 2026-09-18

### Fixed

- Clock updates again. The 1.3.1 precompiled-`dist` packaging froze the
  panel completely (painted once, never repainted), so this release reverts
  to the 1.3.0 source entrypoint: the singleton clock with event fan-in and
  the staleness watchdog drives live repaints again. Version 1.3.1 stays
  published but is deprecated — do not install it.
- Panel footer now shows the release version (`edit: /dspeak · v1.3.2`) so a
  running install can be told apart from a stale cached copy.

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
