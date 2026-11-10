# Native-waste fixes

Resume here: P1 (store the tool catalog once per Session) is the only item with a measured multi-megabyte target. The
former P0 (a 2.82 GB live heap) and P2 (an 8.7 s Session list) are closed: on 2026-11-10 the live Host held 409–579 MB
RSS and `session list read` spans ran p50 47 ms / p95 320 ms; what fixed them is in
[RAM usage](../../docs/ram-usage.md#the-live-host-now-2026-11-10). The browser-tab bound (former P3) is tracked in
[ultra-fast](../ultra-fast/README.md). Fork procedure and manifest rules: [native plugin overrides](../../docs/native-plugin-overrides.md)
and [native forks](../../docs/native-forks.md).

| Item                   | State | Owner                                 | Cost                                                                     | Next step                                                                                                              |
| ---------------------- | ----- | ------------------------------------- | ------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| P1 request headers     | Open  | `agent-loop` fork writes, persistence | 8.87 MB in one Session (34 events × ~260 KB, 455-tool catalog each time) | Storage dedupe in a persistence-jsonl fork (option 1 below)                                                            |
| P4 storage list paging | Open  | `dshx` `plugin-storage.list`          | 20 ms / 7 500 keys, 15 pages per read                                    | Index or point read, only if a real caller needs it                                                                    |
| P5 Effect duplication  | Open  | `dshx` client build                   | +166 KB gzip for the tested supplier + 2 consumers                       | Full-profile counterfactual first; `shared-runtime` now supplies `effect` to every client, so re-measure before acting |
| P6 mark batches        | Open  | `diff-viewed` + storage               | one file toggle ~16 ms at 7 k marks                                      | Only with a real batch workload; the confirmed-prefix failure is b:2ksz                                                |

## P1 — store the tool catalog once per Session

Measured on the decompressed log of `session-6b9ec57a` (19.39 MB, zstd 5.43 MB): **34 `request/header` events = 9.30 MB
= 48 % of the log**; reasons `initial` 1, `resume` 1, `change` 1, **`series` 31**; the `tools` JSON is 9.29 MB of those
bytes; every one of the 34 catalogs is **byte-identical** (455 tools). About 8.5 MB is pure repetition.

Writer: `buildRequest` in the vendored [`agent.ts`](../../plugins/@dshfiles/agent-loop/src/native/agent.ts). It emits
`initial`/`resume` once, `change` only when `headerEquals` fails, and `series` on every request-series start **with the
unchanged full header** (still the case on 2026-11-10: `this.session.append('request/header', { header, reason: 'series' })`).

No reader wants a per-group catalog: `dsh-session` keeps tools per header seq for `headerSeq` lookups and resets on
`series`; `tool-history` feeds `requestHeader()` and `dsh-llm`'s tool-update projection; the timed ask-user question and
token-meter recompute from the latest tools. The browser receives the **full** copy (our
[`browser-event.ts`](../../plugins/@dshfiles/session-controller/src/browser-event.ts) strips only assistant replay),
where conversation and trajectory diff it with `JSON.stringify` and chat reads only `reason`/`startsSeries`.

Ranked options:

1. **Storage dedupe, no reader change.** The `@dshfiles/session-persistence-jsonl` fork exists now: write the catalog
   once per Session plus a per-event reference, rehydrate inline on read. Every reader and the browser stay untouched,
   the log loses ~8.5 MB of 19.4 MB. Risk: `session-log-download` and older harnesses must not read the new artifact.
2. **Browser-boundary strip for `series` only.** The session-controller fork can drop the repeated catalog from `series`
   events; needs client fallbacks in the forked chat/conversation plus a new trajectory fork. Cuts traffic and client
   RAM, log unchanged.
3. **Format v5 catalog reference.** Writer plus a `dsh-session` fork (408 K, 30 importers, no Loader row, and the ref
   shape forces `SESSION_FORMAT_VERSION` 5), migrations and trajectory. Biggest win, worst replay/export risk.

Plan: option 1 first, option 2 second, option 3 only if the first two leave a measured gap. Confirming metric: header
bytes ÷ log bytes (48 % then, distinct catalog arrays = 1) on a regenerated Session, plus page-open bytes and client heap.

## P4–P6 — only with a caller

Each is measured but unproven as a user-visible cost: `pluginStorage.list` paging (P4), Effect in every client bundle
(P5), and `diff-viewed` batch writes (P6). They stay open until a real workload shows the cost; the evidence is on
b:r5rp, b:d060 and b:0b04.
