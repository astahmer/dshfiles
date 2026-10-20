# @dshfiles/session-controller

Owned fork of DSH's native Session controller row (Host commands, `session/follow`, history pages, and the browser
Session client). It keeps the native behaviour and changes what a thread costs to open (see Local delta): on the live
profile one Anthropic thread opened with a 26 MB snapshot, 17 MB of it thinking signatures the browser never reads.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-api-session-controller@0.2.1-rc.2` (MIT, [LICENSE](./LICENSE))
- Pinned revision: tag `dsh-v0.2.1-rc.2`
- Vendored source: [`src/native`](./src/native) is upstream `packages/api/session-controller/src`; [`locale`](./locale)
  is upstream `locale`.
- Typert: `pnpm build` derives [`typert/host.js`](./typert) from the installed stock `lib/typert.host.js`
  ([`scripts/derive-typert.mjs`](./scripts/derive-typert.mjs)), changing only the manifest's package name, which the
  Typert loader requires to equal this package's name.

### Why a whole-package fork

`session/follow`, history paging and the browser's opening window live inside this package's Host controller and
Session client; no Slot, service or setting reaches them. This package replaces the `session-controller` Loader row:
its `cordis.patch.yml` disables `session-controller` and inserts `dshfiles-session-controller`. Native rows that
declare `dsh.client.inject` on the stock package keep loading: the browser module table still serves the stock
`/client` module, and `ctx.sessions` comes from this row.

### Local delta

Every other vendored file is byte-identical to the pinned revision.

| File                                    | Change                                                                                                                                                                                               |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/history.ts`                 | `entryFor` sends `BrowserEvent.of(event)`: history pages and live follow events reach the browser without per-block provider replay state                                                            |
| `src/browser-event.ts`                  | new: drops `replayState.blocks` from `assistant/message` and `assistant/attempt` (message source and stream chunks), keeps `replayState.response` (ids, native stop reason)                          |
| `src/native/client/sessions/session.ts` | a thread opens with `OPENING_PAGE_OPTIONS` (latest Turn, 20–120 messages) instead of the 50-message, two-Turn, 500-cap window; older pages keep the native window                                    |
| `src/native/list.ts`                    | cold rows keep their projection column per Session id until that Session attaches, appends or detaches; every `session/list` used to re-read each cold Session log's compressed prefix (Host gap 70) |
| `src/native/client/index.ts`            | typing only: no duplicate `Context.sessions` augmentation (the stock one reaches every dshx client program), and the connection cast goes through `unknown` (dshx types see Host types)              |
| `src/host.ts`, `src/client-entry.tsx`   | new: dshx entries calling the native plugin                                                                                                                                                          |
| `src/mime-types.d.ts`                   | new: the one `mime-types` call's type; upstream gets it from its workspace                                                                                                                           |

### Build

`tsconfig.host.json` compiles the Host side with tsc into `build/host` first: the dshx bundler keeps TC39 `@Remote`
decorators as written, and Node rejects them; upstream's build compiles with tsc too. `dshx build` then bundles
`build/host/host.js`. The client inlines what the native client chunk inlines and loads `@deepseek-ai/cordis`,
`@deepseek-ai/dsh-api-gateway/client` and `@deepseek-ai/dsh-client-store` from the module table, as the native build
does. `pnpm typecheck` runs the client program and the Host program with its tests (`tests/host`).

`src/host.ts` is the fork's entry shim and must import the vendored native entry `src/native/index.ts`, so the lint and
format configs exclude it with `src/native/**`.

### Updating upstream

1. `node scripts/native-fork-diff.mjs session-controller --to <new-tag>` lists what upstream changed between the pinned tag and
   the new one, and which of those files carry a local delta.
2. Copy the new `src` over `src/native`, re-apply the delta table, and bump the pinned version here and in
   [docs/native-forks.md](../../../docs/native-forks.md).
3. `pnpm build && pnpm typecheck && pnpm test`, then `node scripts/check-browser.mjs boot session-controller` and the
   composer and sidebar journeys.
