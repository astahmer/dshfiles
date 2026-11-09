# @dshfiles/storage-domain

Owned fork of DSH's storage domain form (`@deepseek-ai/dsh-storage-domain`). It keeps the upstream spec vocabulary,
write chain, event contract and error behaviour, and adds two capabilities: lazy per-record hydration, and a
multi-record `putMany` that is one durable publish on a backend that stores the unit as one document.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-storage-domain@0.2.1-rc.2` (MIT, [LICENSE](./LICENSE))
- Pinned revision: tag `dsh-v0.2.1-rc.2`
- Vendored source: [`src/native`](./src/native) is upstream `packages/storage/storage-domain/src`
- Provenance and delta files: [`native-fork.json`](./native-fork.json), checked by `node scripts/native-fork-diff.mjs`

## Local delta

| File | Change |
| --- | --- |
| `src/native/spec.ts` | optional `hydration: 'lazy' \| 'all'` field |
| `src/native/index.ts` | seeds a qualifying per-record domain from document keys, with the legacy-bootstrap fallback |
| `src/native/domain.ts` | lazy table (64-row LRU, one record hydrated per miss) and `KvTable.putMany` |
| `src/native/error.ts` | `batch-partial` error code |

### Batch writes (`KvTable.putMany`)

`putMany(entries)` inserts or overwrites several records in one durable write. It occupies ONE slot of the domain's
write chain, so no other write of that domain interleaves with it.

- **One document, one publish.** On a backend that publishes the unit as one document (the JSON `single` layout) the
  whole batch is one durable publish, so it is all-or-nothing at the document level. A rejected batch leaves the
  previously persisted state intact and nothing of it durable; the rejection is the backend's own error.
- **No rollback promise beyond that publish.** There is no cross-document recovery protocol: the batch is not a
  transaction, it is one document write.
- **Per-record fallback.** A backend with one document per record has no whole-unit publish. There the batch still
  holds its chain slot but each record lands on its own, so a mid-batch rejection leaves the records written before
  the failure durable and visible. That rejection is a `DomainError` with code `batch-partial`, and its message names
  how many records landed.
- **Duplicates.** Duplicate keys apply in order, so the last value wins; the key keeps its first-appearance position.
- **Events.** Exactly one `domain/changed` `put` event per distinct key, after durability — never one per duplicate
  entry, and none at all for a rejected batch.
- **Empty batch.** Writes nothing and emits nothing.

`put`, `delete` and `update` are unchanged: each is still one durable write and one event.

## Tests

```sh
pnpm --dir plugins/@dshfiles/storage-domain test
pnpm --dir plugins/@dshfiles/storage-domain typecheck
```

`tests/batch-writes.test.ts` counts durable writes through the counting backend, so "one publish" is asserted
rather than inferred.
