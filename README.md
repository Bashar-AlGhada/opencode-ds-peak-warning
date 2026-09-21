# ds-peak-warningx

[![npm version](https://img.shields.io/npm/v/ds-peak-warningx.svg)](https://www.npmjs.com/package/ds-peak-warningx)
[![weekly downloads](https://img.shields.io/npm/dw/ds-peak-warningx.svg)](https://www.npmjs.com/package/ds-peak-warningx)
[![Publish to npm](https://github.com/Bashar-AlGhada/opencode-ds-peak-warning/actions/workflows/publish.yml/badge.svg)](https://github.com/Bashar-AlGhada/opencode-ds-peak-warning/actions/workflows/publish.yml)

An [opencode](https://opencode.ai) TUI plugin that shows DeepSeek's **peak / off-peak
pricing windows** in your terminal, so you know when requests are more expensive.

DeepSeek charges more during peak hours. The default schedule follows their
current billing rules: peak windows **01:00–04:00** and **06:00–10:00 UTC**
on weekdays, and **fully off-peak weekends** — evaluated by the Beijing
calendar day. Every window can carry its own day-of-week pattern, so any
weekday-based pricing rule can be configured.

## Features

- **Status dot** — colored `● PEAK` / `● OFF-PEAK`: red at peak, green
  off-peak, yellow when peak starts within 30 minutes. On v1 it sits next to
  the home prompt; on v2 it lives in the footer status row. The permanent
  `(can freeze)` note means the display can paint stale data after sleep or
  a timer stall — treat it as guidance.
- **Sidebar panel** — current status, UTC + local time, next transition
  across days, and per-window countdowns. Collapsible to a compact status
  line from `/dspeak`.
- **`/dspeak`** — in-app window management (add, remove, reset) with a live
  status header. Edits persist across restarts. Format: `HH:MM-HH:MM` in UTC,
  optionally restricted to weekdays (`22:00-02:00`, `06:00-10:00 Mon-Fri`,
  `14:00-16:00 Sat,Sun`). Days are Beijing calendar days; wrapping midnight
  is fine.
- **Peak guard** (on by default) — asks for confirmation before DeepSeek
  prompts go out during peak. `block` mode holds the prompt until confirmed;
  `warn` mode just toasts. One confirmation silences it for the cooldown
  (default 5 minutes, `0` = ask every time). `/dspeak-confirm` pre-confirms
  up front. Slash commands, shell mode, and typing are never blocked.

## opencode v1 (requires `>=1.18.29`)

### Install

From this repo (global):

```sh
git clone https://github.com/Bashar-AlGhada/opencode-ds-peak-warning ~/.config/opencode/ds-peak-warningx
cd ~/.config/opencode/ds-peak-warningx
npm install
```

Then add it to `~/.config/opencode/tui.json` (path relative to the config file):

```json
{
  "$schema": "https://opencode.ai/tui.json",
  "plugin": ["./ds-peak-warningx/src/index.tsx"]
}
```

Or via CLI: `opencode plugin ~/.config/opencode/ds-peak-warningx -g`.
Restart opencode.

From npm:

```sh
opencode plugin ds-peak-warningx@1.5.0 -g    # drop -g for per-project
```

(Or in-TUI: `ctrl+p` → `plugins` → `shift+i`, type `ds-peak-warningx@1.5.0`.)

### Updating

```sh
opencode plugin ds-peak-warningx@1.5.0 -g -f   # keep -g if installed globally
```

Then restart opencode. Check `npm view ds-peak-warningx version` for the latest.

### Options (`tui.json`)

```json
{
  "plugin": [["ds-peak-warningx@1.5.0", { "ranges": [
    { "start": "01:00", "end": "04:00", "days": [1, 2, 3, 4, 5] },
    { "start": "22:00", "end": "02:00" }
  ] }]]
}
```

- `ranges` — peak windows overriding the defaults. `days` is 0 = Sunday …
  6 = Saturday (Beijing day); omit for every-day windows. In-app `/dspeak`
  edits win and persist.
- `order` — sidebar slot order (default `150`).
- `panel` — `false` (or the `/dspeak` toggle) collapses the panel to a
  compact status line.
- `guard` — `{ "enabled": true, "mode": "block", "cooldownMs": 300000,
  "providers": ["deepseek"] }`.

## opencode v2

Same package, same features — one `./tui` entry serves both generations.
Differences: the status dot lives in the footer status row, and settings
persist in v2 durable storage (v1 state does **not** carry over — v2 starts
once from options/defaults, then `/dspeak` edits persist).

### Install

In `cli.json` (from npm):

```json
{
  "plugins": [{ "package": "ds-peak-warningx@1.5.0", "options": { "panel": true } }]
}
```

Local checkout (point at the repo root):

```json
{
  "plugins": ["file:///path/to/opencode-ds-peak-warning"]
}
```

Restart opencode.

### Updating

Bump the pinned version in `cli.json` (or `git pull` a local checkout),
then restart opencode.

### Options (`cli.json`)

Same options as v1 (`ranges`, `panel`, `guard`); `order` is v1-only.

## Development

```sh
npm install
npm run typecheck   # tsc --noEmit
npm run sanity      # logic boundary checks
npm run pack        # npm pack --dry-run, shows the published tarball contents
```

The package targets the TUI via `exports["./tui"]` and ships raw `.tsx` source
(opencode's runtime transpiles it).

## License

MIT
