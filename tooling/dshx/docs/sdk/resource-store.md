# Page-wide resource store

Every plugin bundle inlines its own dshx copy, so a TanStack `QueryClient` per bundle reads and polls one Host fact
once per bundle and once per mounted observer. The resource store is one keyed cache for the whole page (on
`globalThis` under `Symbol.for('@dshfiles/dshx.resource-store.v1')`): one entry, one read in flight and one poll timer
per key, whichever bundles subscribe.

```ts
import { useResource, invalidateApiResources } from '@dshfiles/dshx/client'

const revision = useResource(backlogApi, 'revision', undefined, { pollInterval: 5_000, livePollInterval: 60_000, visible })
revision.status // 'idle' | 'pending' | 'success' | 'error'; also data, error, updatedAt, fetching, refetch()

// After a write: re-read every subscribed read of this API tagged 'revision'.
invalidateApiResources({ contract: backlogApi, tags: ['revision'] })
```

- **Key**: owner, API id, version, method, stable JSON of the input and the Connection. Two plugins reading the same
  method and input share an entry; two owners never do.
- **Ref-counted**: the first visible subscriber of a stale key reads it; the last one leaving stops its poll. A caller
  passing `visible: false` keeps the data but never starts a read, and the poll pauses while no subscriber is visible or
  the document is hidden. Showing it again reads once when the poll would have run.
- **Cadence lives on the key**: `staleTime`, `pollInterval`, `livePollInterval`, `shouldPoll` and `pollWhileHidden`
  belong to the definition (the latest registration wins, so give every caller of a key the same values).
  `subscriberPollInterval` lets one caller ask for a shorter poll while it shows more, such as an open popover; the key
  polls at the shortest interval any visible subscriber asks for.
- **Host generation**: while the Connection is down the store pauses; a new Host generation drops unsubscribed keys of
  that Connection and re-reads the subscribed ones, keeping their last data on screen meanwhile.
- **Reads go through the API client**, so identical in-flight reads still coalesce and pick up the Connection transport.

## Push invalidation (`tags` / `invalidates`)

A read names what it returns with `tags`; an event of the same API lists the tags it makes stale:

```ts
defineApi({
  id: 'backlog',
  version: 1,
  owner: '@dshfiles/backlog',
  methods: { revision: method({ output: Schema.Number, readOnly: true, tags: ['revision'] }) },
  events: { changed: event({ schema: Schema.Struct({ revision: Schema.Number }), invalidates: ['revision'] }) },
})
```

While a key has subscribers, the store follows the API's invalidating events through the page's dshx events stream.
An event re-reads only subscribed keys carrying one of its tags. While every such event is `live`, the key polls at
`livePollInterval` (omit it to rely on pushes alone); a Host that does not publish the event leaves the status
`unavailable`, so the key keeps its `pollInterval`. Turning live re-reads once, since missed events are not replayed.
Tags are scoped to their API, so declare `owner` on contracts that use them.

## Other adapters

- `resourceStore()` is the framework-free core: `register(definition)`, `subscribe(key, listener, { visible })`,
  `getSnapshot(key)` (same object until the key changes), `ensure(key, { force })`, `invalidate({ tags } | { key })`,
  `mutate(key, update)`. `apiResource({ client, method, input, options })` registers a dshx read and returns its key.
- TanStack bridge for gradual migration: `resourceQueryOptions(...)` from `@dshfiles/plugin-ui/query`, whose
  `queryFn` reads through the store.
