# @dshfiles/session-persistence-jsonl

Owned fork of
[`@deepseek-ai/dsh-session-persistence-jsonl`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/session/session-persistence-jsonl)
pinned at `dsh-v0.2.1-rc.2`. It replaces the `session-persistence-jsonl` Loader row; the native row is disabled, DSH
core stays untouched. Provenance and the delta list are in [`native-fork.json`](./native-fork.json); drift is checked
with `node scripts/native-fork-diff.mjs session-persistence-jsonl`.

## Why

Every request that begins a new message series appends one `request/header` event carrying the **full assembled tool
catalog**. The loop writes it on purpose: the latest snapshot reconstructs the request header, so a reader needs the
whole catalog, not a delta. But the catalog is identical across a Session's requests, and re-writing it per series is
pure repetition.

Measured on the decompressed log of `session-6b9ec57a` (19.39 MB, zstd 5.43 MB, 2026-11-09):

| Part of the artifact             | Bytes    |
| -------------------------------- | -------- |
| Whole Session log                | 19.39 MB |
| 34 `request/header` events       | 9.30 MB  |
| `tools` JSON inside those events | 9.29 MB  |
| Distinct catalogs (455 tools)    | 1        |

31 of the 34 headers carry `reason: "series"`; all 34 catalogs are byte-identical. The fork stores that catalog **once
per Session artifact** and writes a digest reference on every later request whose catalog matches, then expands the
reference inline on read. Every reader — `dsh-session`'s header fold, `tool-history`, `dsh-llm`'s tool-update
projection, token-meter, the browser migration path, session search and the log export — keeps receiving the same
events it always did.

## Delta

| File                   | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/format.ts` | `TOOL_CATALOG_MARKER` / `TOOL_CATALOG_REFERENCE`, `ToolCatalogWriter` (first row writes the catalog, later rows write a reference, staged per durable batch), `rehydrateToolCatalog` in `SessionLogScanner`, and the marker-aware header line encode/parse                                                                                                                                                                                                                                                      |
| `src/native/index.ts`  | one `ToolCatalogWriter` per session write handle, committed only after its batch is durable; the header probes and the migration-publish header line carry/strip the marker; one-Session reads (`stat`, `resolveCurrentLog`, `open` for read) never wait for the root-wide encoding walk (a root it refused keeps refusing them), an id a complete listing under a minute old did not see reads as absent without probing every project directory, and an otherwise unknown id probes the projects 16 at a time |

`src/host.ts`, `scripts/build-worker.mjs` and the tests are ours: the Host entry re-exports the native plugin class
unchanged, and the build emits the upstream migration verifier as its own `dist/worker.cjs` (upstream's second tsdown
entry). Because a bundled ESM dependency reads its own package metadata through `createRequire(import.meta.url)`, the
worker build defines `import.meta.url` as `dist/worker.cjs`; without that shim a CJS bundle has no `import.meta` and the
verifier thread dies on load.

### On-disk shape

A marked artifact keeps the released v4 row format. The header line gains one key:

```json
{ "type": "session", "version": 4, "id": "session-…", "dshfilesCatalogDedupe": 1, … }
```

The first `request/header` row that carries a catalog writes it in full; every later row with the same catalog writes

```json
{ "header": { "config": {…}, "tools": { "$dshfilesToolCatalog": "<sha256 of the tools JSON>" } } }
```

The reference is resolved against catalogs already read earlier in the same artifact, in file order, so a resumed
writer that does not know the previous process's catalogs simply writes the catalog again (one extra copy per process
restart, never a dangling reference).

### Compatibility guard

`dshfilesCatalogDedupe` is outside the released v4 header key set, and the released header codec rejects unknown keys.
A harness **without** this fork therefore refuses a marked artifact while parsing its header line: it cannot read a
reference as an empty tool list and silently drop the Session's tools. Its `open(id)`/read rejects; its `list()` skips
the unclassifiable header, so the Session is absent there rather than shown with no tools. Recovery is to run the
harness with this bundle (or export the Session from a Host that has it). Old logs, and every artifact this fork writes
with no repeated catalog, still contain no reference and read identically.

### session-log download / export

`@deepseek-ai/dsh-session-query/session-log-export` serializes from the persistence **read** seam, so a downloaded
ZIP contains the canonical pre-fork v4 JSONL with every catalog inline. That archive is larger than the stored
artifact (one catalog per header again) and readable by every harness, including one without this fork.

## Verification

```sh
pnpm --dir plugins/@dshfiles/session-persistence-jsonl typecheck
pnpm --dir plugins/@dshfiles/session-persistence-jsonl test
pnpm --dir plugins/@dshfiles/session-persistence-jsonl build
node scripts/native-fork-diff.mjs session-persistence-jsonl
```

`tests/tool-catalog-dedup.test.ts` writes the same Session through the stock backend and this fork, asserts the
artifact shrank and carries one catalog, asserts both reads return identical events and that
`foldRequestHeader` still reconstructs all 455 tools, reads a pre-fork artifact with the fork, and asserts the stock
backend refuses a deduped artifact. A compressed variant covers the zstd container and a reopened writer.

## Update policy

Copy the upstream `src` files, re-apply the two deltas, bump `upstream.version` / `upstream.ref` here and in
`native-fork.json`, then run `native-fork-diff`, typecheck, test and build. The upstream README is kept as
[`UPSTREAM.md`](./UPSTREAM.md).
