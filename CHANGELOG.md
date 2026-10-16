# Changelog

All notable changes to this plugin are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.2] — 2026-10-17

### Fixed

- `client.js` registers its lazy factory under the package's published name. It
  still called `__ModuleLoader__.load({ id: 'dsh-balance-window' })` after the
  package moved into the scope, and a client bundle whose id does not match its
  package name loads without registering — which failed the whole entry with
  `client-modules: could not load "@alexey_demin/dsh-balance-window" … loaded
  without registering`. 0.1.1 fixed the Host row name but missed this one, so
  neither 0.1.0 nor 0.1.1 produced a visible chip.
- The account-fallback client identity now reports the published package name
  instead of the pre-scope one.

### Added

- `scripts/check-client-id.mjs`, wired into `npm test`, `npm run check` and
  `prepublishOnly`: it evaluates `client.js` with a stub `__ModuleLoader__` and
  fails when the registered id differs from the package name — exactly the 0.1.2
  bug, and the reason 0.1.0 and 0.1.1 shipped a bundle that could not register.

## [0.1.1] — 2026-10-17

### Fixed

- The bundle row now addresses the Host half by the package's published name,
  `@alexey_demin/dsh-balance-window`. In 0.1.0 the row still said
  `dsh-balance-window`, which no npm install can resolve, so the plugin failed to
  activate for anyone installing the published package.

### Changed

- `package.json`: dropped the misleading `main` (the ESM entry is `exports["."]`),
  replaced the `npm init` stub test script with real syntax gates
  (`check`/`test`/`prepublishOnly`), and added `publishConfig.access: public` so a
  scoped publish cannot silently land as restricted.

## [0.1.0] — 2026-10-16

### Added

- A fixed chip in the sidebar foot (`sidebar.footer.action`, entry
  `balance-window`) showing the wallet balance and the cost of the newest turn.
  It is a column occupant: no dragging, no collapsing, no dismiss button, and it
  survives the 56px rail as a two-line stack.
- A hover/keyboard-focus info panel with the recharge and granted split, today's
  total and turn count, the newest turn's cost, tokens, steps, route and peak
  flag, the read timestamp, and the estimate disclaimer. It is anchored with
  viewport coordinates and wrapped in an error boundary.
- Host route `GET /balance-window/state` that reads
  `https://api.deepseek.com/user/balance` with the stored `DEEPSEEK_API_KEY`
  (falling back to the `deepseekAccount` service on an account login) and folds
  durable `assistant/message` usage events into per-turn costs at the published
  DeepSeek rates (off-peak and peak, cache hit/miss/output).
- Per-row configuration for the credential ref, cache lifetime, request
  timeout, price table, peak windows, USD→CNY rate, and turn retention.

[0.1.0]: https://github.com/AlexeyDemin0/dsh-balance-window/releases/tag/v0.1.0

[0.1.1]: https://github.com/AlexeyDemin0/dsh-balance-window/releases/tag/v0.1.1

[0.1.2]: https://github.com/AlexeyDemin0/dsh-balance-window/releases/tag/v0.1.2
