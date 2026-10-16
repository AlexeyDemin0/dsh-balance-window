# dsh-balance-window

[![npm version](https://img.shields.io/npm/v/@alexey_demin/dsh-balance-window.svg)](https://www.npmjs.com/package/@alexey_demin/dsh-balance-window)
[![license](https://img.shields.io/npm/l/@alexey_demin/dsh-balance-window.svg)](LICENSE)
[![DeepSeek Harness](https://img.shields.io/badge/DeepSeek%20Harness-%3E%3D0.2.0--rc.2-247bbf.svg)](#requirements)

A fixed chip in the DeepSeek Harness sidebar foot, right beside **Settings**: the
wallet balance `platform.deepseek.com` shows and what the last turn cost. Hover
it (or focus it with the keyboard) and an info panel opens above it with the
full reading.

```
sidebar foot, expanded:                56px rail:
  ⚙ Settings   [ ● $4.76  $0.0264 ]      ⚙
                                          ●
                                        $4.76
                                       $0.0264
```

```
        ┌──────────────────────────────────────┐
        │ BALANCE                              │
        │ $4.76                                │
        │ topped up $4.76                      │
        │ ──────────────────────────────────── │
        │ Last turn #2                $0.0264  │
        │ 24 steps · 5.23M tokens ·            │
        │ deepseek-flash                       │
        │ ──────────────────────────────────── │
        │ Today        $0.0264 · 2 turns       │
        │ 5.23M tokens                         │
        │ Updated 17:41:07 · estimate at       │
        │ published rates · click to refresh   │
        └──────────────────────────────────────┘
   ⚙ Settings   [ ● $4.76  $0.0264 ]
```

The chip is a slot occupant of the sidebar column, not a floating window: it
cannot be dragged, collapsed, dismissed or moved, and it stays visible in the
56px rail too. Clicking it forces a balance refresh (with `≈` in front of the
turn figure while that turn is still running). Its copy ships in English,
Russian and Chinese.

## Requirements

- DeepSeek Harness `>= 0.2.0-rc.2` running the **Web UI** (`dsh web`) — the visible
  half is a `platform: web` client plugin.
- A stored `DEEPSEEK_API_KEY` (Settings → Models). On Desktop an account login
  works too: the Host falls back to the `deepseekAccount` service.
- Nothing else: no build step and no runtime dependencies, `host.js` and
  `client.js` ship as they are.

## Install

Through the Plugin Manager / market UI, or from a shell:

```sh
# from npm
dsh plugin --profile web add @alexey_demin/dsh-balance-window

# from git
dsh plugin --profile web add github:AlexeyDemin0/dsh-balance-window
```

Then reload the page: the chip appears in the sidebar foot next to Settings.
Uninstall with `dsh plugin --profile web remove @alexey_demin/dsh-balance-window`.

## The hover panel

- Opens on `mouseenter` and on keyboard focus; closes 180 ms after the pointer
  leaves, and immediately on blur. Moving the pointer onto the panel keeps it
  open, and its numbers can be selected and copied.
- Anchored above the chip with `position: fixed` coordinates taken from the
  chip's viewport rect — the sidebar column clips its scrolled content, so an
  in-flow popover would be cut off. It re-anchors on window resize.
- Wrapped in an error boundary: a panel render failure logs to the console and
  drops only the panel, never the chip.
- It shows: balance, recharge/granted split, the newest turn (number, cost,
  tokens, steps, model, `peak` when the peak tariff applied), today's total and
  turn count, the read timestamp, the estimate disclaimer, and any read error.

## Where the numbers come from

| Figure                                   | Source                                                                                                                                                                                   |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Balance (and the recharge/granted split) | Host `GET https://api.deepseek.com/user/balance` with the stored `DEEPSEEK_API_KEY`; falls back to the `deepseekAccount` service when only an account login exists (Desktop).            |
| Last turn cost                           | Host fold over durable `assistant/message` usage records (`inputTokens` = cache miss, `cacheReadTokens` = cache hit, `outputTokens` includes reasoning), priced with the official rates. |
| `Today`                                  | Sum of the turns folded since the plugin loaded — or since local midnight, whichever is later; the accumulator resets when the local date changes.                                       |

The API key stays on the Host: the browser only receives the JSON that
`/balance-window/state` returns.

**The per-turn figure is an estimate.** It is `tokens × published price`, not a
billing record:

- Search/Fetch API fees ($0.75 per 1,000 requests) are not counted.
- Chinese public holidays are not modelled, so a turn inside a peak window on a
  holiday is priced at the peak (double) rate.
- Compaction tokens and any provider-side accounting the harness does not log
  are invisible here.
- The wallet balance is the one authoritative figure — the API balance and the
  fold will disagree by exactly these effects.

Default prices come from <https://api-docs.deepseek.com/quick_start/pricing>
(off-peak USD per 1M tokens):

| family                                  | cache hit | cache miss | output |
| --------------------------------------- | --------- | ---------- | ------ |
| `flash` (`deepseek-flash`, …)           | 0.003     | 0.15       | 0.6    |
| `pro` (`deepseek-v4-pro`, `*reasoner*`) | 0.022     | 0.66       | 1.98   |

Peak = 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, at ×2. A wallet in CN¥
is converted with `usdToCny` (default 7.2).

## Configuration

Every field is optional and lives in the plugin row's `config` in
`cordis.patch.yml` (or in the profile's own patch file, which is the same shape).
See the commented block in [`cordis.patch.yml`](cordis.patch.yml); defaults are
`refreshMs: 60000`, `timeoutMs: 8000`, `keepTurns: 20`, `usdToCny: 7.2`,
`path: '/balance-window/state'`.

## Layout

- Slot: `sidebar.footer.action` (the row beside Settings at the sidebar foot),
  entry id `balance-window`, order 20. The owner passes `wide` — `false` in the
  56px rail — so the chip lays out as one line when there is room and as two
  stacked numbers when there is not.
- Styles use theme tokens only (`--dsw-alias-*`), so light and dark themes both
  read correctly; no Harness Client package is imported.
- The chip polls its Host route every 10 s while the tab is visible; the Host
  caches upstream balance reads for `refreshMs`, and clicking the chip forces
  one.

## Limits

- The "last turn" is the newest completed turn across all sessions (or the turn
  currently running), not the sidebar's selected session.
- A turn appears when `turn/end` is logged, so the turn you are watching shows
  as the `≈` figure while it runs.
- Long numbers are ellipsised in the rail; the panel always carries the exact
  values.

## Troubleshooting

| Symptom                                                   | Cause and fix                                                                                                                                                                                 |
| --------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The chip shows `—` with a yellow dot                      | The Host could not read the wallet. Put an API key in Settings → Models (stored as `DEEPSEEK_API_KEY`), or sign in to a DeepSeek account on Desktop. The hover panel carries the exact error. |
| The chip disappeared after installing or toggling plugins | The Host loads a plugin's module once per process. Restart `dsh web`.                                                                                                                         |
| Balance is right, turn cost is `—`                        | No turn has finished since the plugin loaded. The first completed turn fills it in.                                                                                                           |
| Turn cost differs from the platform dashboard             | It is an estimate, not a billing record — see the caveats above.                                                                                                                              |
| The chip is in the wrong language                         | It follows the UI locale; English, Russian and Chinese copy ship with the plugin.                                                                                                             |
| I want it somewhere else, or hidden                       | Not supported by design: the chip is a fixed occupant of the sidebar foot, so it cannot be moved, collapsed or dismissed. Fork the plugin and register into another slot if you need that.    |

## Development

There is nothing to build: `host.js` and `client.js` ship as they are, so a
checkout installs in place.

```sh
dsh plugin --profile web add link:/path/to/dsh-balance-window
```

The Host loads a plugin's module once per process, so restart `dsh web` after
editing `host.js`. `client.js` is served to the page on every load, so a page
reload is enough there. `npm test` (or `npm run check`) is the whole syntax gate.
The row name in `cordis.patch.yml` is the package name — change one and you must
change the other.

## Support

Questions and bug reports: [issues](https://github.com/AlexeyDemin0/dsh-balance-window/issues).

## License

[MIT](LICENSE) © Alexey Demin
