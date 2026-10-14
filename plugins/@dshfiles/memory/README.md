# @dshfiles/memory

Cross-thread, cross-project memory for DSH that leaves the live context and the provider's KV cache alone.

- **No capture store.** DSH's own session logs are the source of truth. When a thread has been idle for `idleMs`
  (60 s), its log is read once through DSH's `sessionQuery` service and turned into a **digest** with
  `digestSession` from `@dshfiles/dshx/platform/session-digest`: the user's requests in order, their corrections and
  decisions verbatim, goal, todos, jj revision descriptions, files changed and the final answer. No model call is made
  unless the thread left no trail of its own; then one cheap call (OptMem's `cheapModels` routing, reasoning `off`)
  writes it. Blank and trivial threads get no digest; identical digests and notes are stored once.
- **One frozen start block.** At the first prompt assembly of every agent (subagents included), a byte-bounded block
  (`blockBytes`, 1,600) is appended to the end of the system prompt: a fixed instruction, notes, and thread pointers
  grouped by project and ranked by citations, then recency. It is frozen per thread (persisted, so a Host restart does
  not change it) and identical for every thread of a project until memory changes, so it sits in the cached prefix and
  is never re-emitted mid-thread.
- **Tools.** `memory_search` (digests, valid notes and indexed messages; FTS5 porter words plus trigram identifiers,
  BM25 fused by reciprocal rank, recency decay, project and note-type boosts), `memory_read` (a digest, a note, or a
  bounded raw excerpt read back from the session log), `memory_note` (add, update with a reason — the old row stays as
  superseded history — or forget with a reason). Note types follow Claude Code: `user`, `feedback`, `project`,
  `reference`, with `scope`, `confidence` and the source thread and message.
- **Citations as usage.** The block asks agents to cite memory they used as `memory: <id>`. A citation marks the tool
  call that returned the id as used and ranks the cited item higher in later blocks.
- **Memory panel** (sidebar → Memory): notes by type with their source (project, thread, message, who wrote it,
  created and updated), inline edit and forget, superseded history, markdown preview through DSH's own
  `MarkdownText`; thread digests by project; usage per day.

Message text is indexed with contentless FTS5 tables (the index only; the text stays in the session log). Credential
shapes, bearer tokens, `key=value` secrets and tokenized URLs are redacted before anything is indexed, digested,
noted or returned, and an excerpt never shows tool output that names a credential file.

Optional: TypeSafe's Jev (`jevEnabled`, `TYPESAFE_API_KEY`) flags user messages as durable signals at digest time and
gates whether a new thread gets thread pointers at all. Any failure falls back to the heuristics.

Out of scope: promoting facts into AGENTS.md or skills, reading `~/.agents`, mid-thread injection, thread handoff.

`@dshfiles/memory` and `@dshfiles/optmem` both register `memory_search`; load one of them per profile.

## Retrieval: BM25 by default, hybrid with your own embedder

`retrieval: 'bm25'` (default) ranks with FTS5 only. `retrieval: 'hybrid'` fuses BM25 with vector similarity by
reciprocal rank, but only when `embeddingProvider` loads; otherwise BM25 serves and the Memory panel's header says why.
Memory ships no model and no embedding dependency. A provider is any ES module whose default export returns
`{ model, embed(texts, kind) }` (`src/embedder.ts`): one unit-length `Float32Array` per text; `kind` is `query` or
`document`. Digests and notes are embedded in bounded batches after each digest, note and search; vectors are stored per
model, so switching models re-embeds. For example, with `@huggingface/transformers` installed where the module can
resolve it:

```js
// ~/.dsh/memory-embedder.mjs → embeddingProvider: "/Users/me/.dsh/memory-embedder.mjs"
import { pipeline } from '@huggingface/transformers'

export default async function createEmbedder() {
  const extract = await pipeline('feature-extraction', 'Xenova/bge-small-en-v1.5', { dtype: 'q8' })
  const prefix = { query: 'Represent this sentence for searching relevant passages: ', document: '' }
  return {
    model: 'bge-small-en-v1.5-q8',
    embed: async (texts, kind) => {
      const output = await extract(
        texts.map(text => prefix[kind] + text),
        { pooling: 'cls', normalize: true },
      )
      const size = output.dims.at(-1)
      return texts.map((_, row) => output.data.slice(row * size, (row + 1) * size))
    },
  }
}
```

The [benchmark](docs/benchmark.md#retrieval-bm25-vs-local-embeddings-vs-hybrid) is why BM25 is the default.

## Per-project roll-up (designed, not built)

A roll-up would rewrite one short summary per project at most once a day, out of band, from what changed since the
last run: the previous summary plus the digests and notes added since its watermark, in one cheap call (reasoning
`off`), stored as a searchable item and never placed in the start block. It is not built because search does not need
it yet: on the recall set in [`docs/benchmark.md`](docs/benchmark.md), BM25 alone finds every exact identifier and
24 of 25 natural recall questions among 5,000 items. Its misses are paraphrases with no shared word, which a summary
does not fix either; local embeddings recover some of them (see the retrieval experiment).

## Settings (`dshfiles-memory`)

`enabled`, `crossProject` (true), `blockBytes` (1,600), `blockStaleDays` (90: never-cited threads older than this
leave the block), `idleMs` (60,000), `summarizerProvider` / `summarizerModel` / `summarizerEffort` (`off`),
`cheapModels`, `jevEnabled` (false), `jevThreshold` (0.5), `retrieval` (`bm25`; or `hybrid`), `embeddingProvider` (empty),
`retentionDays` (365; notes stay until forgotten).

## Develop

```sh
pnpm typecheck && pnpm test && pnpm build
fnm exec --using=22.23.3 node -e "import('./dist/index.js')"
```

`src/scale.test.ts` seeds 5,000 synthetic digests and notes and bounds search latency and block size. The benchmark
against native DSH and OptMem is in [`docs/benchmark.md`](docs/benchmark.md).
