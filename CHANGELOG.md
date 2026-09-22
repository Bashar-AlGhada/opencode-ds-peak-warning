# Changelog

All notable changes to this project will be documented in this file.

## Unreleased

### Fixed

- v1 status indicators now refresh within the model-state polling interval
  after selecting a model through `/model`, before a prompt is sent.

### Known limitations

- v1 exposes no process-local model-selection event, so live status refreshes
  use its global `model.json` state. Cross-process writes, identical no-op
  saves, and delayed writes across session switches can briefly misattribute a
  model. Keyboard model cycling remains invisible until v1 exposes a signal.

## [1.5.0] - 2026-09-21

### Added

- opencode v2 (2.x) support from the same package: the `./tui` entry now
  exports both contracts (`{ id, tui }` for v1, `{ id, setup }` for v2), so
  one install works on either generation. The v2 path reuses the shared
  pricing logic (windows, coverage array, guard decision, clock) against the
  v2 CLI context: sidebar panel via `sidebar.content`, status dot via
  `home.footer.status`, `/dspeak` + `/dspeak-confirm` as palette/slash
  commands (the keymap layer registers from an `append: "app"` slot render,
  where it has an owning component), durable storage instead of KV, and the
  prompt guard wrapped around the v2 client's `session.prompt`. The `/dspeak`
  main menu renders via `dialog.show()` with the same live header as v1
  above a native keyboard-driven select list with descriptions (explicit
  row height — the widget has no intrinsic size); leaf submenus stay
  promise-based, matching v1's host-dialog leaves.
- v2 watchdog event catalog pinned by the sanity suite against the installed
  `@opencode/client` generated types (both directions), like the v1 SDK pin.
- Root `tui.ts` entry re-exporting `src/index.tsx`: v2 resolves local
  directory specs to `<dir>/tui` (not to `package.json` exports), so without
  it a `file:///...` checkout entry silently never loads. npm consumers are
  unaffected (`exports["./tui"]` still points at `src/index.tsx`).

### Changed

- Minimum v1 version is now `>=1.18.29` (dual object-form entrypoints only
  load there).
- The status views now consume a minimal theme-color surface shared by both
  generations (v2 nested `ResolvedTheme` tokens are adapted onto it).

### Notes for v2 testers

- v1 KV state does not carry over to v2 (different storage backend keyed by
  the v1 host): v2 starts once from options/defaults, then `/dspeak` edits
  persist going forward.
- The `order` plugin option is v1-only; v2 composes slots in plugin enable
  order.
- The peak guard is ported best-effort: if the v2 TUI send path bypasses the
  wrapped `session.prompt`, the sidebar shows `Guard: unavailable` instead of
  silently failing — please report what you see.

## [1.4.0] - 2026-09-19

### Added

- Sidebar panel is now optional: a `/dspeak` → `Sidebar panel` toggle (plus a
  `panel` plugin option) collapses or expands it live, full details by
  default. The collapsed state keeps the `● PEAK/OFF-PEAK` status, the freeze
  disclaimer, and the `edit: /dspeak` line; the choice persists across
  restarts and the home-screen status dot is unaffected.
- `/dspeak` opens with a live status header (peak state, UTC + local time,
  next switch with countdown, compact windows line) computed fresh on open
  and ticking with the shared clock, like the panel. Never persisted.
- Status lines are now three-toned: red at peak, green off-peak, and yellow
  when off-peak with a peak flip less than 30 minutes away. Applied to the
  home dot, full panel, collapsed panel, and the `/dspeak` header from one
  shared helper so the views cannot disagree.
- Every status line — home screen, full sidebar panel, and collapsed panel —
  carries a permanent muted `(can freeze)` note: a view can paint stale data
  after sleep or a timer stall, so the status is guidance, not a billing
  guarantee.

### Changed

- Peak guard is now on by default (`block` mode), keeping both guard and
  panel optional-but-on. Only installs with no saved guard settings gain the
  new default; any saved `/dspeak` guard choice or `guard` option wins.

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
