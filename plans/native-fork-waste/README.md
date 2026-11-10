# Native-fork waste: what is left

The finished parts are documented where they live: the per-Session tool-catalog dedupe and its reopen seed in the
[session-persistence-jsonl README](../../plugins/@dshfiles/session-persistence-jsonl/README.md) and
[performance.md](../../docs/performance.md#session-log-tool-catalog-bytes-2026-11-10); the storage `listAll` and
`putMany` wins (former P4 and P6) in
[performance.md](../../docs/performance.md#plugin-storage-list-and-review-mark-batches-landed-2026-11-09); the Host heap
and Session list (former P0, P2) in [RAM usage](../../docs/ram-usage.md). Fork rules:
[native plugin overrides](../../docs/native-plugin-overrides.md), [native forks](../../docs/native-forks.md).

| Item                          | State                         | Owner                       | Measured cost                                                  |
| ----------------------------- | ----------------------------- | --------------------------- | -------------------------------------------------------------- |
| A. Catalog shared by Sessions | Proposed, not started         | `session-persistence-jsonl` | 22 % of decompressed log bytes, 16.6 % of on-disk bytes        |
| B. One Effect copy in clients | Blocked on namespace identity | `dshx` client build         | 69 web-profile clients 35.1 → 28.9 MB raw, 9.95 → 8.06 MB gzip |

## A. One tool catalog shared across Sessions

Every Session artifact still holds its first catalog in full. On the 75 live logs of 2026-11-10 that copy is 16.8 MB of
75.7 MB decompressed (22 %) and about 65 KB zstd per log, 3.9 MB of 23.6 MB on disk (16.6 %). It dominates short
subagent logs: 0.28 MB of a ~1.3 MB log. Most of those Sessions carry the same 468-tool catalog.

Design: a content-addressed store beside the Session root (`<root>/.tool-catalogs/<sha256>.json.zstd`), written with
temp file, fsync and directory fsync **before** the first row that names it. That row writes a distinct reference
(`{"$dshfilesSharedToolCatalog": "<sha256>"}`) so the reader knows to look outside the artifact; the in-artifact
reference and the reopen seed stay as they are. The read path keeps a small LRU of decoded catalogs. Readers above the
persistence seam see no change.

Risks to settle before building it:

1. **Copies of a raw log lose the catalog.** Anything that copies `session.v4.jsonl.zstd` without the store (the
   `.dshthread` export if it copies raw bytes, `session-repair-backups`, multi-host moves, a user's manual backup) yields
   an unreadable artifact. The log export reads through the seam and is safe; each raw copier needs checking.
2. **Garbage collection.** Deleting a catalog needs a mark-and-sweep over every artifact (or refcounts kept with the
   same durability as the logs). Without it the store only grows, by one file per distinct catalog.
3. **Raw readers.** `scripts/tool-schema-cost.ts` reads the last full catalog in the file; a log with only shared
   references has none. Session search and usage read `config` only.
4. **Older harnesses.** The header marker already makes a pre-fork harness refuse the artifact; keep it that way.

Expected saving: up to 22 % of decompressed and ~16 % of on-disk log bytes, minus one store file per distinct catalog.
`@dshfiles/tool-search` makes catalogs per Session distinct (36 tools, then 5 more per search), which this design
neither helps nor hurts; per-tool storage would be the follow-up only if tool-search becomes the default.

## B. One Effect copy across client bundles (b:d060)

Every client bundle inlines `effect` because the dshx client runtime imports it. A matched counterfactual that provides
the Effect root and eight subpaths through `@dshfiles/shared-runtime` changed the 69 web-profile client bundles from
35,094,489 to 28,893,256 bytes raw (9,947,040 to 8,057,977 gzip-9); the supplier grew 756,133 raw / 233,094 gzip, about
7 average consumers to break even. Composed boot passed. It fails the identity gate in Chromium: the compiler's facade
makes the root `Option`/`Schema` namespace differ from the subpath namespace inside one consumer (true before). Next
step: a dshx provider-only build mode, or an externalization that preserves namespace identity, then the same
counterfactual and identity probe. Needs an idle machine: full profile builds at load 30+ are not valid numbers.
