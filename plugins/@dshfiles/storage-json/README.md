# @dshfiles/storage-json

Owned fork of DSH's JSON storage backend (`@deepseek-ai/dsh-storage-json`). It keeps the upstream file formats, the
atomic publish protocol and every write path, and adds two capabilities the owned `@dshfiles/storage-domain` fork
needs: synchronous per-record reads, and one-publish batch writes on the single-document layout.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-storage-json@0.2.1-rc.2` (MIT, [LICENSE](./LICENSE))
- Pinned revision: tag `dsh-v0.2.1-rc.2`
- Vendored source: [`src/native`](./src/native) is upstream `packages/storage/storage-json/src`
- Provenance and delta files: [`native-fork.json`](./native-fork.json), checked by `node scripts/native-fork-diff.mjs`

## Local delta

| File | Change |
| --- | --- |
| `src/native/per-record-unit.ts` | synchronous per-record reads (`listKeysSync`, `getRecordSync`, `getGlobalSync`) so the domain fork can hydrate one record on first read instead of materializing the whole unit at open |
| `src/native/single-unit.ts` | `putRecords(table, entries)`: several records in ONE document publish |

### Batch writes (`putRecords`)

The `single` layout keeps the whole unit in one document, so every write is a full-document rewrite. `putRecords`
applies a whole batch to the authoritative memory, serializes once, and publishes once through the same
temp-file/fsync/rename protocol as `putRecord`.

- One durable publish for the batch, so it is all-or-nothing at the document level.
- A rejected publish rolls every key of the batch back: the file keeps the previous document and memory keeps the
  previous records. Nothing of the batch is durable, and the rejection is the underlying backend/fs error.
- Duplicate keys apply in order, so the last value wins; first appearance keeps the key's position in the document.
- An empty batch writes nothing at all (no temp file, no rename).
- A restart reads exactly the records of the last committed publish.

`putRecord`, `deleteRecord` and `setGlobal` are unchanged: each is still one publish.

## Tests

```sh
pnpm --dir plugins/@dshfiles/storage-json test
pnpm --dir plugins/@dshfiles/storage-json typecheck
```

`tests/batch-writes.test.ts` counts the durable publishes by intercepting the atomic `rename`, so "one rewrite" is
asserted rather than inferred.
