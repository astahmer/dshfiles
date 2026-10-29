# Host loop freezes

Why this plugin replaced the stock search backend, the numbers behind that choice, and how to measure it again. The
backend itself is described in the [README](../README.md).

## The freeze

On 2026-10-18 the live Web Host stopped making progress for several minutes and had to be killed. The log showed no
crash: an `llm/retry` scheduled with a 1.1 s delay never fired, and the restart failed once with `EADDRINUSE` because
the old process still held the port. The process was alive and its timers were starved.

The cause was the stock `@deepseek-ai/dsh-session-query-sqlite` backend, which runs index maintenance on the Host event
loop when a search arrives:

1. Every search observes **every** loaded session: it `structuredClone`s the header and all events, rebuilds every
   search document and hashes the JSON, even when nothing changed. Changed live sessions are deleted and re-inserted
   wholesale.
2. Every log whose revision (`dev:ino:size:mtimeNs:ctimeNs`) differs is read whole, one after another.
3. All writes go into one `BEGIN IMMEDIATE … COMMIT` through `node:sqlite` `DatabaseSync`: no batching, no yielding.
4. An abort between cold reads discards everything already done.

The trigger chain was ours: the palette's `#` view aborts the previous request on every keystroke, and after the
`@dshfiles/memory` finder's 1.5 s deadline it started an un-abortable warm search that ran the whole backlog at full
speed.

## Measured baseline

Measured 2026-10-18 on a corpus of 808 sessions (1.26 GB compressed) against a live index of 682 sessions and 356 823
documents. The backlog was 204 changed logs (460 MB) and 127 never indexed (198 MB). Raw numbers:
[`evidence/freeze-baseline-2026-10-18.json`](evidence/freeze-baseline-2026-10-18.json).

| Scenario                             | Search wall | Host stall  | What it is                                                     |
| ------------------------------------ | ----------- | ----------- | -------------------------------------------------------------- |
| S1 cold catch-up (whole backlog)     | 336.8 s     | **290.5 s** | one unbroken transaction; +111 047 documents                   |
| S3 warm search, 18 live sessions     | 43.6 s      | **43.5 s**  | no durable writes; the whole cost is re-observing the live set |
| S4 one giant log changed (49.5 MB)   | 44.3 s      | **44.2 s**  | +12 588 documents                                              |
| S6 restart catch-up (20 newest logs) | 132.4 s     | **129.8 s** | +19 296 documents                                              |

What the numbers settled:

- **Warming the index does not fix it.** A fully warm index still stalls 43.5 s per search, because every search
  re-materialises every loaded session.
- **Search is not the cost; maintenance is.** On the real 946 MB index an FTS5 `MATCH` answers in 27-70 ms and a ranked
  page with snippets in 473 ms. The stall is maintenance on the read path, a property of the design rather than a
  tunable constant.
- **Typing amplification was not the largest term.** Even one search on a quiet, warm instance was about 170 times over
  budget.

## Budget

| Gate           | Budget                                                                   |
| -------------- | ------------------------------------------------------------------------ |
| Host stall     | max 250 ms, p99 100 ms (external probe round trip)                       |
| Search latency | p95 ≤ 1.5 s on a warm index                                              |
| Correctness    | same result sets, same degradation labels                                |
| Background tax | ≥ 5 ms of Host time per second before a plugin write is worth optimising |

## Decisions

- **Own the backend instead of tuning it.** Smaller fixes were weighed first: single-flight content search in the
  finder, a scheduled warm, and switching content search off (`openAt: never`, which `@dshfiles/memory` already degrades
  to a labeled title/workspace/memory page). The first two cut repeated work but cannot get under the 43.5 s warm floor;
  the third removes a feature the user wanted. None was built.
- **Subclass, do not fork, the read engine.** `SessionSearchEngine` extends core's `SessionQueryEngine` and overrides
  only `searchSessions` / `searchEvents`, so the inherited reads stay core's code.
- **Ingest by frame cursor, commit in bounded batches, cap document text.** Spikes before building: split frame decoding
  is byte-identical to a whole-file decode (18 691 frames); 200 000 documents indexed in a worker cost the Host a
  109.5 ms worst gap; an 8 KB per-event cap keeps the giant log at 74 MB of stored text instead of 157 MB. The shipped
  caps are 64 KB for conversation and 8 KB for tool traffic.
- **Live sessions come from their logs.** A committed `session/event` nudges the worker (coalesced to 500 ms), which
  indexes the appended frames in one bounded batch. Core's clone-hash-rebuild of the whole session per search is gone.
- **The stock row is disabled in two places.** An existing profile reconciles only the seed's managed region, so a
  disable above it never reached the live profile: the stock backend registered first, kept the `sessionQuery`
  service, and the freeze stayed while `session_search_health` reported a healthy index nothing read. The disable now
  sits in this bundle's `cordis.patch.yml` and inside the seed's managed region, and
  `sessionSearchOwnershipErrors` in [`verify-web-profile-contract.mjs`](../../../../scripts/verify-web-profile-contract.mjs)
  fails the contract when either drops it.
- **Filters are mapped, not refused wholesale.** At cutover both real callers failed with
  `SESSION_QUERY_INVALID_FILTER`, because the finder and core's session controller send `type` and `surface` clauses.
  Those, `seq` and `time` now map onto SQL predicates; regression tests cover the exact caller shapes through the real
  worker.

The resulting numbers against the stock backend are in the README's [Measured](../README.md#measured) section.

## Measuring a stock backlog

`bench:freezes` replays the live index backlog into a throwaway copy of the stock index and measures what one content
search does to the event loop. The corpus and the live index are opened read-only; every write lands in the run
directory.

```sh
pnpm --dir plugins/@dshfiles/memory bench:freezes -- \
  --run-dir /private/tmp/dsh-freeze-bench/<round> \
  --scenarios S1,S3,S4,S6 \
  --out /private/tmp/dsh-freeze-bench/<round>.json
```

The script lives in [`@dshfiles/memory`](../../memory/bench/host-loop-freezes.ts) because that package resolves the
installed `@deepseek-ai/dsh-session-query-sqlite` engine. It reproduces the corpus (same log selection and revision
string as the installed persistence), the backlog (the revision mismatch between the live index and the corpus), the
cold read and the real `SqliteSessionQueryEngine`.

| Id  | Shape                                                     | Question                                |
| --- | --------------------------------------------------------- | --------------------------------------- |
| S1  | the whole live backlog, one search, no abort              | what does a single catch-up cost?       |
| S2  | 12 searches aborted after 200 ms, then one settled search | does typing multiply the work?          |
| S3  | warm index plus a live set                                | what does an ordinary warm search cost? |
| S4  | warm index with the largest log changed                   | how bad is one giant session?           |
| S6  | warm index with the newest N logs changed                 | what does a restart leave behind?       |

`externalLag.maxRttMs` is the Host-stall number: a second process pings a socket the measured process serves every
25 ms, so the round trip is how long a user's request would wait. `externalLag.p99GapMs` is the pinger's own cadence
and does not show a stall. `lag.maxGapMs` is the in-process timer gap.

Absolute numbers drift as the live corpus grows: compare only rounds measured against one snapshot.

Two traps the bench already handles:

- **Decode every frame.** A session log is concatenated Zstandard frames. A one-shot `zstdDecompressSync` stops at the
  first frame (208 decoded bytes for a 26 MB log) and under-measures the cold read by orders of magnitude.
- **Drain one macrotask before stopping the probes.** Otherwise the awaited work resolves in the microtask queue before
  the starved timer and the queued pings are serviced, and the largest stall is silently dropped. An earlier revision
  reported a 169 ms gap for a five-minute search this way.

The owned backend has its own bench, `pnpm --dir plugins/@dshfiles/session-search bench:owned`, described in the
README.
