# Host-loop freeze bench

Replays the **live index backlog** into a throwaway copy of the index and measures what one content search does to the
event loop. Nothing here writes to the live DSH: the corpus and the live index are opened read-only, and every write
lands under a run directory in temporary storage.

## Running it

```sh
pnpm --dir plugins/@dshfiles/memory bench:freezes -- \
  --run-dir /private/tmp/dsh-freeze-bench/<round> \
  --scenarios S1,S3,S4,S6 \
  --out plans/host-loop-freezes/harness/<round>.json
```

The script lives next to the finder it measures
([`plugins/@dshfiles/memory/bench/host-loop-freezes.ts`](../../../plugins/@dshfiles/memory/bench/host-loop-freezes.ts))
because that package already resolves the installed `@deepseek-ai/dsh-session-query-sqlite` engine and runs TypeScript
benchmarks through `node --experimental-strip-types`.

## What it reproduces

- **The corpus**: every session directory under `~/.dsh/sessions`, with the same current-generation log selection and
  the same `dev:ino:size:mtimeNs:ctimeNs` revision string the installed persistence lists.
- **The backlog**: the revision mismatch between the live index and the corpus is replayed into the index copy, so a
  scenario cold-reads exactly the sessions the live index is behind on (plus the ones it never indexed).
- **The cold read**: the concatenated Zstandard frame container is decoded frame by frame, the way
  `dsh-session-persistence-jsonl` does it. A one-shot `zstdDecompressSync` of a whole log stops at the first frame and
  under-measures by orders of magnitude (observed: 208 decoded bytes for a 26 MB log).
- **The engine**: the real `SqliteSessionQueryEngine` from the installed core package, pointed at the index copy.
- **The live set for S3**: real logs cycled into the requested number of live sessions, so the engine's per-search
  observation cost tracks real event volume.

## Scenarios

| Id  | Shape                                                     | Question                                                        |
| --- | --------------------------------------------------------- | --------------------------------------------------------------- |
| S1  | the whole live backlog, one search, no abort              | what does a single catch-up cost the Host loop today?           |
| S2  | 12 searches aborted after 200 ms, then one settled search | does typing multiply the work?                                  |
| S3  | warm index plus a live set                                | what does an ordinary warm search cost?                         |
| S4  | warm index with the largest log changed                   | how bad is one giant session?                                   |
| S6  | warm index with the newest N logs changed                 | what does a restart leave behind?                               |
| S5  | idle, no search                                           | the plugins' background tax (measured separately, see the plan) |

## Metrics

- `wallMs` — how long the search call took.
- `externalLag.maxRttMs` — **the Host-stall number**: a separate process pings a socket this process serves every 25 ms,
  so its round-trip time is how long a user's request would wait. `externalLag.p99GapMs` is the pinger's own cadence
  and is not a stall measurement.
- `lag.maxGapMs` — the in-process timer gap, useful for seeing how the stall is chopped up.
- `coldReads` — sessions read, compressed and decoded bytes, frame count, and the split between I/O, frame decoding,
  synchronous JSON parsing, and the time the engine spent between reads.
- `index` — sessions and documents added.

## Instrumentation trap

Both probes are torn down **after one macrotask turn** (`await new Promise(resolve => setTimeout(resolve, 500))`).
Without that drain, the awaited work resolves in the microtask queue before the starved timer and the queued socket
pings are ever serviced, so the largest stall of all — the reconciliation transaction — is silently dropped. An
earlier revision of this bench reported "max gap 169 ms" for a five-minute search because of exactly this.

## Results

Each round writes one JSON file under this directory with the numbers only (no session ids). Compare rounds measured
against the same snapshot; the live corpus grows, so absolute numbers drift between days.
