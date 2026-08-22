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

## What you get

- A colored `● PEAK` / `● OFF-PEAK` dot next to the prompt on the home screen.
- A sidebar panel in every session showing current status, UTC + local time,
  the next transition, and a countdown per window (`(active)` / `(in 5h 20m)`).
- In-app editing with `/dspeak` — no config file editing. Your windows persist
  across restarts.

## Quick install (from this repo, global)

1. Clone this repository somewhere permanent (e.g. into your global config dir)
   and install its dependencies:

   ```sh
   git clone https://github.com/Bashar-AlGhada/opencode-ds-peak-warning ~/.config/opencode/ds-peak-warningx
   cd ~/.config/opencode/ds-peak-warningx
   npm install
   ```

2. Add the plugin to your global TUI config `~/.config/opencode/tui.json`:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["./ds-peak-warningx/src/index.tsx"]
   }
   ```

   The path is relative to the config file itself (`~/.config/opencode/`), so the
   panel now shows in **every** project.

3. Restart opencode.

Or use the CLI instead of step 2:

```sh
opencode plugin ~/.config/opencode/ds-peak-warningx -g
```

## Install from npm

```sh
opencode plugin ds-peak-warningx -g    # global, or without -g per project
```

Or from inside the opencode TUI:

1. Press `ctrl+p` to open the command palette, type `plugins`, and select it.
2. Press `shift+i` to install a plugin, type `ds-peak-warningx`, and press enter.
3. Press `space` to toggle the scope (local project vs global), then confirm.
4. Restart opencode.

## Usage

- The sidebar panel shows `UTC` time, your local time + timezone, and the next
  status change (e.g. `Next: off-peak at 04:00 UTC`).
- Press `/` and run `dspeak` to add, remove, or reset peak windows.
  Format: `HH:MM-HH:MM` in UTC, optionally restricted to weekdays:
  `22:00-02:00`, `06:00-10:00 Mon-Fri`, `14:00-16:00 Sat,Sun`, `20:00-21:00 Wed`.
  Days refer to the Beijing calendar day (wrapping midnight is fine).

## Options

You can set the windows at install time with the `[spec, options]` tuple in `tui.json`:

```json
{
  "plugin": [["ds-peak-warningx", { "ranges": [
    { "start": "01:00", "end": "04:00", "days": [1, 2, 3, 4, 5] },
    { "start": "22:00", "end": "02:00" }
  ] }]]
}
```

- `ranges` — peak windows overriding the defaults. Each window may carry a
  `days` array (0 = Sunday … 6 = Saturday, Beijing calendar day) restricting
  it to those weekdays; omit `days` for an every-day window. Later in-app
  edits via `/dspeak` win and persist.
- `order` — sidebar slot order (default `150`).

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
