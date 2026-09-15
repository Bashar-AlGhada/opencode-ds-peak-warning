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
  the next transition across days (e.g. `Next: peak at 01:00 UTC Mon` after a
  Friday evening), and a per-window countdown that respects its weekday
  pattern.
- In-app editing with `/dspeak` — no config file editing. Your windows persist
  across restarts.
- An optional peak guard that asks for confirmation before DeepSeek prompts
  go out during peak hours (see `Peak guard` below).

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
opencode plugin ds-peak-warningx@1.1.2 -g    # global, or without -g per project
```

Or from inside the opencode TUI:

1. Press `ctrl+p` to open the command palette, type `plugins`, and select it.
2. Press `shift+i` to install a plugin, type `ds-peak-warningx@1.1.2`, and press enter.
3. Press `space` to toggle the scope (local project vs global), then confirm.
4. Restart opencode.

## Updating

Installed plugins don't upgrade automatically — installs are pinned to the
version you specify. Reinstall with the new version and the force flag, then
restart opencode:

```sh
opencode plugin ds-peak-warningx@1.1.2 -g -f   # keep -g if installed globally
```

Check this page or `npm view ds-peak-warningx version` for the latest release.

## Usage

- The sidebar panel shows `UTC` time, your local time + timezone, and the next
  status change (e.g. `Next: off-peak at 04:00 UTC`).
- Press `/` and run `dspeak` to add, remove, or reset peak windows.
  Format: `HH:MM-HH:MM` in UTC, optionally restricted to weekdays:
  `22:00-02:00`, `06:00-10:00 Mon-Fri`, `14:00-16:00 Sat,Sun`, `20:00-21:00 Wed`.
  Days refer to the Beijing calendar day (wrapping midnight is fine).

## Peak guard

An opt-in confirmation step before prompts that would go out on a DeepSeek
model during peak hours (off by default).

- Turn it on via `/dspeak` → `Peak guard` → `Enable guard`. The sidebar panel
  then shows a `Guard:` line with the current state and the last outcome
  (e.g. `Guard: block 5m · last sent 02:31`).
- In `block` mode, sending a DeepSeek prompt during peak opens a confirmation
  dialog: confirm to send, cancel to drop it. In `warn` mode, prompts send
  normally and you just get a warning toast.
- One confirmation silences the guard for the cooldown (default 5 minutes;
  `0` means ask on every prompt). Change it under `Peak guard` → `Cooldown`.
- Run `/dspeak-confirm` any time to confirm up front and start the cooldown
  without waiting for a prompt.
- Slash commands (`/sessions`, `/models`, …), shell mode, and typing are never
  blocked — only the DeepSeek request itself asks for confirmation.

## Options

You can set the windows at install time with the `[spec, options]` tuple in `tui.json`:

```json
{
  "plugin": [["ds-peak-warningx@1.1.2", { "ranges": [
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
- `guard` — opt-in prompt guard: `{ "enabled": true, "mode": "block",
  "cooldownMs": 300000, "providers": ["deepseek"] }`. `mode` is `"block"`
  (ask for confirmation before sending) or `"warn"` (send normally, show a
  warning toast); `cooldownMs: 0` asks on every prompt. In-app `/dspeak`
  guard edits win and persist.

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
