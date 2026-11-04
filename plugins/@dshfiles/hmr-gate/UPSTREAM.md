# Upstream

- **Package replaced:** `@deepseek-ai/dsh-client-hmr` (MIT), row id `client-hmr`
- **Upstream version read:** `0.2.1-rc.2`
- **Shape:** reimplementation of the transport, not a byte-identical vendor, so
  there is no `native-fork.json`. The client half is rewritten with a same-origin
  `EventSource`; the stock one also carries an `eventsource-parser` stream and the
  shell `__DSH_TRANSPORT__` fetch path (see the README's limits).

Each vendored behaviour and where it is:

| Upstream behaviour                                                | Here                                               |
| ----------------------------------------------------------------- | -------------------------------------------------- |
| GET `/plugins/events` SSE route via `ctx.webServer.register`      | `src/host.ts`, `hmr-gate: /plugins/events channel` |
| 500 ms stat poll of each row's client bundle (`artifactBaseline`) | replaced: `src/host/bundle-watcher.ts` (see below) |
| `graph` frames on connect and on graph change                     | `src/host.ts`, `broadcast`                         |
| `rebuilt` frames from `clientModules.onRebuilt`                   | `src/host.ts`                                      |
| browser half: `entries.sync(graph)` / `entries.reload(id, rev)`   | `src/client.tsx`                                   |

The delta is the gate: instead of announcing every `clientModules.rebuilt(id)`,
the Host compares the package's Host artifact on disk with the digest it loaded
(see `src/host/gate.ts`), announces only while they agree, and emits a `deferred`
frame carrying both generations otherwise.

The second delta is the trigger. The stock transport `statSync`s every bundle every
500 ms on the Host's main thread (the 2026-11-04 Host profile: 232 ms per 20 s).
`src/host/bundle-watcher.ts` instead `fs.watch`es each bundle directory and its
package directory (which survives a clean build replacing `dist/`), reads only the
bundles an event names with async `stat`, polls a directory only while it cannot be
watched, and re-reads everything every 10 s in case a watch dropped an event.

## Update policy

On every DSH bump, read `packages/client/hmr` at the new tag and compare the
behaviour table above. Copy any transport change (route, poll, frame shapes,
connection lifecycle). Do not copy the stock half blindly: the gate needs the row's
`artifactBaseline` path and the Host entry resolution to keep working for both
native (`lib/index.js`) and owned (`dist/index.js`) layouts.

If DSH ever exposes a per-package compatibility check in `ReleaseChangeGate` or a
filter hook on the transport, delete this package and use the stock row.
