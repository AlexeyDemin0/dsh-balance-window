# dsh-balance-window

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
        │ БАЛАНС                               │
        │ $4.76                                │
        │ пополнение $4.76                     │
        │ ──────────────────────────────────── │
        │ Последний ход #1            $0.0264  │
        │ шагов: 24 · 5.23M токенов ·          │
        │ deepseek-flash                       │
        │ ──────────────────────────────────── │
        │ Сегодня      $0.0264 · ходов: 1      │
        │ 5.23M токенов                        │
        │ Обновлено 17:41:07 · оценка по       │
        │ опубликованным тарифам · щелчок —    │
        │ обновить                             │
        └──────────────────────────────────────┘
   ⚙ Settings   [ ● $4.76  $0.0264 ]
```

The chip is a slot occupant of the sidebar column, not a floating window: it
cannot be dragged, collapsed, dismissed or moved, and it stays visible in the
56px rail too. Clicking it forces a balance refresh (with `≈` in front of the
turn figure while that turn is still running).

## Requirements

* DeepSeek Harness `>= 0.2.0-rc.2` running the **Web UI** (`dsh web`) — the visible
  half is a `platform: web` client plugin.
* A stored `DEEPSEEK_API_KEY` (Settings → Models). On Desktop an account login
  works too: the Host falls back to the `deepseekAccount` service.
* Nothing else: no build step and no runtime dependencies, `host.js` and
  `client.js` ship as they are.

## Install

Through the Plugin Manager / market UI, or from a shell:

```sh
# from git (no npm publish required)
dsh plugin --profile web add github:AlexeyDemin0/dsh-balance-window

# from a local checkout, for development
dsh plugin --profile web add link:/path/to/dsh-balance-window

# from npm, once the package is published
dsh plugin --profile web add dsh-balance-window
```

Then reload the page: the chip appears in the sidebar foot next to Settings.
Uninstall with `dsh plugin --profile web remove dsh-balance-window`.

Editing `host.js` requires a `dsh web` restart (the Host caches one module
generation per plugin per process); editing `client.js` is picked up by a page
reload.

## The hover panel

* Opens on `mouseenter` and on keyboard focus; closes 180 ms after the pointer
  leaves, and immediately on blur. Moving the pointer onto the panel keeps it
  open, and its numbers can be selected and copied.
* Anchored above the chip with `position: fixed` coordinates taken from the
  chip's viewport rect — the sidebar column clips its scrolled content, so an
  in-flow popover would be cut off. It re-anchors on window resize.
* Wrapped in an error boundary: a panel render failure logs to the console and
  drops only the panel, never the chip.
* It shows: balance, recharge/granted split, the newest turn (number, cost,
  tokens, steps, model, `пик` when the peak tariff applied), today's total and
  turn count, the read timestamp, the estimate disclaimer, and any read error.

## Where the numbers come from

| Figure | Source |
|---|---|
| Balance (and the recharge/granted split) | Host `GET https://api.deepseek.com/user/balance` with the stored `DEEPSEEK_API_KEY`; falls back to the `deepseekAccount` service when only an account login exists (Desktop). |
| Last turn cost | Host fold over durable `assistant/message` usage records (`inputTokens` = cache miss, `cacheReadTokens` = cache hit, `outputTokens` includes reasoning), priced with the official rates. |
| `Сегодня` | Sum of the turns folded since the plugin loaded — or since local midnight, whichever is later; the accumulator resets when the local date changes. |

The API key stays on the Host: the browser only receives the JSON that
`/balance-window/state` returns.

**The per-turn figure is an estimate.** It is `tokens × published price`, not a
billing record:

* Search/Fetch API fees ($0.75 per 1,000 requests) are not counted.
* Chinese public holidays are not modelled, so a turn inside a peak window on a
  holiday is priced at the peak (double) rate.
* Compaction tokens and any provider-side accounting the harness does not log
  are invisible here.
* The wallet balance is the one authoritative figure — the API balance and the
  fold will disagree by exactly these effects.

Default prices come from <https://api-docs.deepseek.com/quick_start/pricing>
(off-peak USD per 1M tokens):

| family | cache hit | cache miss | output |
|---|---|---|---|
| `flash` (`deepseek-flash`, …) | 0.003 | 0.15 | 0.6 |
| `pro` (`deepseek-v4-pro`, `*reasoner*`) | 0.022 | 0.66 | 1.98 |

Peak = 01:00–04:00 and 06:00–10:00 UTC, Monday–Friday, at ×2. A wallet in CN¥
is converted with `usdToCny` (default 7.2).

## Configuration

Every field is optional and lives in the plugin row's `config` in
`cordis.patch.yml` (or in the profile's own patch file, which is the same shape).
See the commented block in [`cordis.patch.yml`](cordis.patch.yml); defaults are
`refreshMs: 60000`, `timeoutMs: 8000`, `keepTurns: 20`, `usdToCny: 7.2`,
`path: '/balance-window/state'`.

## Layout

* Slot: `sidebar.footer.action` (the row beside Settings at the sidebar foot),
  entry id `balance-window`, order 20. The owner passes `wide` — `false` in the
  56px rail — so the chip lays out as one line when there is room and as two
  stacked numbers when there is not.
* Styles use theme tokens only (`--dsw-alias-*`), so light and dark themes both
  read correctly; no Harness Client package is imported.
* The chip polls its Host route every 10 s while the tab is visible; the Host
  caches upstream balance reads for `refreshMs`, and clicking the chip forces
  one.

## Limits

* The "last turn" is the newest completed turn across all sessions (or the turn
  currently running), not the sidebar's selected session.
* A turn appears when `turn/end` is logged, so the turn you are watching shows
  as the `≈` figure while it runs.
* Long numbers are ellipsised in the rail; the panel always carries the exact
  values.

## Publishing

```sh
git remote add origin git@github.com:AlexeyDemin0/dsh-balance-window.git
git push -u origin main

# optional, if you also want it on npm
npm publish
```

Bump `version` in `package.json` and add a `CHANGELOG.md` entry per release. Keep
the `dsh.engines.dsh` range honest — DSH validates it against `dsh --version` both
when the plugin is installed and when the profile boots.

## License

[MIT](LICENSE) © Alexey Demin
