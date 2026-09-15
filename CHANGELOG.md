# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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
