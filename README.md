# ds-peak-warning

An [opencode](https://opencode.ai) TUI plugin that shows DeepSeek's **peak / off-peak
pricing windows** in your terminal, so you know when requests are more expensive.

DeepSeek charges more during peak hours. The defaults are **01:00–04:00** and
**06:00–10:00 UTC**; everything else is off-peak.

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
   git clone https://github.com/Bashar-AlGhada/opencode-ds-peak-warning ~/.config/opencode/ds-peak-warning
   cd ~/.config/opencode/ds-peak-warning
   npm install
   ```

2. Add the plugin to your global TUI config `~/.config/opencode/tui.json`:

   ```json
   {
     "$schema": "https://opencode.ai/tui.json",
     "plugin": ["./ds-peak-warning/src/index.tsx"]
   }
   ```

   The path is relative to the config file itself (`~/.config/opencode/`), so the
   panel now shows in **every** project.

3. Restart opencode.

Or use the CLI instead of step 2:

```sh
opencode plugin ~/.config/opencode/ds-peak-warning -g
```

## Install from npm

```sh
opencode plugin ds-peak-warningx -g     # global, or without -g per project
```

Or from inside the opencode TUI:

1. Press `ctrl+p` to open the command palette, type `plugins`, and select it.
2. Press `shift+i` to install a plugin, type `ds-peak-warningx`, and press enter.
3. Press `space` to toggle the scope (local project vs global), then confirm.
4. Restart opencode.

> The original name `ds-peak-warning` still works as an alias:
> `opencode plugin "ds-peak-warning@npm:ds-peak-warningx"`.

## Usage

- The sidebar panel shows `UTC` time, your local time + timezone, and the next
  status change (e.g. `Next: off-peak at 04:00 UTC`).
- Press `/` and run `dspeak` to add, remove, or reset peak windows.
  Format: `HH:MM-HH:MM` in UTC, e.g. `22:00-02:00` (wrapping midnight is fine).

## Options

You can set the windows at install time with the `[spec, options]` tuple in `tui.json`:

```json
{
  "plugin": [["ds-peak-warningx", { "ranges": [{ "start": "22:00", "end": "02:00" }] }]]
}
```

- `ranges` — peak windows overriding the defaults (later in-app edits win and persist).
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
