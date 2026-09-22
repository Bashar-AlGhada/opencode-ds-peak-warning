# ds-peak-warningx

[![npm version](https://img.shields.io/npm/v/ds-peak-warningx.svg)](https://www.npmjs.com/package/ds-peak-warningx)
[![weekly downloads](https://img.shields.io/npm/dw/ds-peak-warningx.svg)](https://www.npmjs.com/package/ds-peak-warningx)
[![Publish to npm](https://github.com/Bashar-AlGhada/opencode-ds-peak-warning/actions/workflows/publish.yml/badge.svg)](https://github.com/Bashar-AlGhada/opencode-ds-peak-warning/actions/workflows/publish.yml)

An [OpenCode](https://opencode.ai) v2 TUI plugin that shows DeepSeek's **peak / off-peak
pricing windows** in your terminal, so you know when requests are more expensive.

## Install

```sh
opencode plugin add ds-peak-warningx
```

The plugin requires an OpenCode v2 host that provides the public selected-model slot
input API. Its status is derived from the live selected model and updates before a
prompt is submitted. It appears when either the provider ID or model ID contains
`deepseek`, case-insensitively, and stays hidden for other or missing models.

## Features

- **Status dot** — colored `● PEAK` / `● OFF-PEAK`: red at peak, green off-peak,
  and yellow when peak starts within 30 minutes. It appears in the prompt and
  footer status rows. The permanent `(can freeze)` note means the display can
  paint stale data after sleep or a timer stall; treat it as guidance.
- **Sidebar panel** — current status, UTC + local time, next transition across
  days, and per-window countdowns. Collapse it to a compact status line from
  `/dspeak`.
- **Live model awareness** — DeepSeek status follows the current provider/model
  selection, including aliases such as `openrouter/deepseek/deepseek-r1`.
- **`/dspeak`** — in-app window management (add, remove, reset) with a live
  status header. Edits persist across restarts. Format: `HH:MM-HH:MM` in UTC,
  optionally restricted to weekdays (`22:00-02:00`, `06:00-10:00 Mon-Fri`,
  `14:00-16:00 Sat,Sun`). Days are Beijing calendar days; wrapping midnight is
  supported.
- **Peak guard** — asks for confirmation before DeepSeek prompts go out during
  peak hours. `block` mode holds the prompt until confirmed; `warn` mode only
  toasts. One confirmation silences it for the cooldown (default 5 minutes,
  `0` = ask every time). `/dspeak-confirm` pre-confirms up front.

## Advanced Configuration

The normal install needs no configuration. For a local checkout or explicit
options, add the package to your OpenCode configuration:

```json
{
  "plugins": [
    {
      "package": "ds-peak-warningx",
      "options": {
        "ranges": [
          { "start": "01:00", "end": "04:00", "days": [1, 2, 3, 4, 5] },
          { "start": "22:00", "end": "02:00" }
        ],
        "panel": true,
        "guard": { "enabled": true, "mode": "block", "cooldownMs": 300000 }
      }
    }
  ]
}
```

- `ranges` — peak windows overriding the defaults. `days` is 0 = Sunday through
  6 = Saturday (Beijing day); omit it for every-day windows. In-app `/dspeak`
  edits win and persist.
- `panel` — `false` or the `/dspeak` toggle collapses the panel to a compact
  status line.
- `guard` — `{ "enabled": true, "mode": "block", "cooldownMs": 300000 }`.

For a local directory install, point the plugin manager at the repository root:

```json
{
  "plugins": ["file:///path/to/opencode-ds-peak-warning"]
}
```

## Development

```sh
npm ci
npm run typecheck
npm run sanity
npm run pack
```

The package exports the v2 plugin through `exports["./tui"]` and the root
`tui.ts` entrypoint. OpenCode transpiles the shipped TypeScript and TSX source.

## License

MIT
