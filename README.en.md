# @skillre/dsh-plugin-pomodoro

> Status: experimental

A Pomodoro focus clock for the DSH Web UI: an ambient timer under the composer, with daily rounds and local preferences.

[中文](README.md)

## What it does

- Renders an ambient pill **under the composer**: current phase, countdown, cycle progress and three controls (start/pause, restart this phase, skip to the next phase).
- Cycles through the classic Pomodoro phases: focus → short break → … → a long break every Nth round → back to focus.
- Counts the focus rounds and focus time completed **today**, rolling over at local midnight.
- Adds one page to **Settings** for the phase lengths, the cycle length and the two autostart switches.

## Non-goals

- No system notification, sound or Notification permission prompt in this version.
- Writes nothing to the Session log and registers no model-visible Tool: a focus timer is pure UI state.
- No cross-device sync.
- Does not keep counting while DSH itself is closed (see Known limitations).

## Install

After publication:

```sh
dsh plugin --profile <profile> add @skillre/dsh-plugin-pomodoro
```

Local development loop (**always through a packed tarball**):

```sh
npm install
npm run check
npm pack
dsh plugin --profile <dev-profile> add ./skillre-dsh-plugin-pomodoro-<version>.tgz
dsh --profile <dev-profile> --dump-config
dsh --profile <dev-profile>
```

Never run `dsh plugin ... add .`: handing the source directory to the package manager creates a source link, so the plugin resolves **its own** `node_modules` instead of the host's — everything looks green locally while a packed install aborts the profile boot. A `file:<tarball>` is the supported form.

Update and rollback: see [UNINSTALL.md](UNINSTALL.md).

## Configuration and defaults

The plugin row has **no** configuration: `cordis.patch.yml` inserts one row with no `config`. Every tunable is a user preference stored in the browser (below), so it is changed in the Settings page rather than in `cordis.patch.yml`.

| Preference | Default | Range | Meaning |
|---|---|---|---|
| Focus length | `25` min | 1–180 | Length of one focus round |
| Short break | `5` min | 1–180 | Break after a regular focus round |
| Long break | `15` min | 1–180 | Break after a full cycle |
| Rounds before a long break | `4` | 1–12 | Focus rounds per cycle |
| Start breaks automatically | on | on/off | A finished focus round flows into its break |
| Start focus automatically | off | on/off | A finished break flows into the next round |

Out-of-range input is **clamped**, never rejected: corrupt or older data degrades into a usable configuration.

## Display metadata

DSH reads plugin-card metadata **without activating the plugin**, so these ship with the package:

- `locale/en.json` (required) and `locale/zh.json`: `{"meta": {"title": ..., "description": ...}}`.
  They resolve through the Node ESM resolver, so `exports` must declare `"./locale/*.json"`; without it DSH
  **swallows** `ERR_PACKAGE_PATH_NOT_EXPORTED` and the card degrades to the bare package name.
- `icon`: the top-level `./icon.svg`, an in-package relative path under 256 KiB, covered by `files`.

| locale | title | description |
|---|---|---|
| `en` | Pomodoro | A focus clock beside the composer, with daily rounds and local preferences. |
| `zh` | 番茄时钟 | 输入框旁的专注计时器：工作/休息循环、每日番茄数与本地偏好。 |

Visible UI copy does not live here: the Client half registers the `skillre-pomodoro` namespace with the Client locale service (`src/client/text.ts`, English and Chinese dictionaries).

## Permissions and effects

- **Network**: none.
- **Credentials / secrets**: none.
- **Filesystem**: none. The Host half is an empty entry point and performs no I/O.
- **Browser storage**: writes `localStorage` under `skillre-pomodoro/state`, holding only the timer state, today's counters and preferences (a versioned payload, currently `2`) — the plugin's own JSON, never Session content, prompts or paths. When storage is unavailable or full it silently degrades to memory and the timer keeps running. A record written by an older version is discarded and restarts paused, rather than guessing its original length from the current config.
- **UI footprint**: two slot registrations (`conversation.composer.dock` and `settings.section`) using the plugin's own `skp-pomodoro-` class prefix and `--dsw-alias-*` theme tokens; it does not read or write product DOM and does not replace host structure.
- **Timers**: one refresh per second while running; when idle it sleeps until the next local midnight, the earliest moment its display can change. Both hang off the plugin's Fiber and are removed on unload.

## Generated and model-visible behaviour

None. The plugin registers no Tool, injects no prompt text and appends no Session events, so the model cannot see the timer.

## Compatibility

| DSH version | Verification completed | Date |
|---|---|---|
| 0.1.7-rc.2 | Packed tarball installed into the `desktop` profile (`application: applied`); the Client module loaded in the real page and registered both slots as active occupants; the artifact loads through the host's module-envelope contract in tests | 2026-09-30 |

**Not yet completed** (so `compatibility.json#verified` stays empty and `release:prepare` fails by design):

- `dump-config` and `bounded-startup`: not run in an isolated profile.
- `browser`: **no** real browser verification was performed. Browser control was unavailable in this environment (CDP could not read Chrome's debug port outside the workspace sandbox), so rendering, light/dark appearance and interaction were never observed.

Per the plugin-development skill, without browser control verification is limited to syntax, manifest and the live Client slot, and no mock preview may stand in for it. The evidence gathered and the open items are recorded in `compatibility.json#observations`. A peer range is not compatibility evidence.

## Known limitations

- The timer needs a live page: while the page is fully closed nothing advances, and reopening settles the phase that expired from absolute timestamps (so a sleeping machine cannot bank several phantom rounds).
- `conversation.composer.dock` is **session**-scoped, so the pill appears with the composer of an active session; the blank new-session screen does not show it. The Settings page (root scope) is unaffected.
- "Today" follows the browser's local time zone; a phase spanning midnight is not interrupted and is credited to the new day when it finishes.
- One `settle` finishes at most one expired phase.
- Each tab keeps its own state reconciled through `localStorage`, with no live cross-tab broadcast: starting in tab A becomes visible in tab B on its next refresh.
- No notification or sound.

## Development

```sh
npm run typecheck   # Host + tests, and the Client half under DOM libs
npm test            # builds lib/client.js, then runs unit and artifact tests
npm run check       # typecheck + test + pack:check
```

The Client half is bundled by esbuild into **one** CommonJS file (`src/client/index.ts` → `lib/client.js`) with only baseline `react` external: the module envelope's `require` resolves the browser module table alone, so a relative `require('./store.js')` would not resolve at runtime. `tests/client-bundle.spec.ts` loads the artifact the way the shell does and fails if a second dependency appears.

Contract queries (2026-09-30, DSH `0.1.7-rc.2`):

- `Slots.listSubTree`: `conversation.composer.dock` (list, session scope, registration `id`/`order`/`label`), `settings.section` (list, root scope, ownerProps `{ close }`).
- Client `Service`: `slots` (`inject`/`register`), `locale` (`register(ns, locale, dict)`/`bind(ns)`/`getLocale`/`subscribe`).
- `Builtin`: `ctx` (restricted Context, `ctx.effect`), `React`; the module envelope is `window.__ModuleLoader__.load({ id, factory })`.
- `Theme`: only `--dsw-alias-*` tokens are used.

## License

MIT
