# @dshfiles/memory: what we learned (2026-10-14)

The page to read first about cross-thread memory in DSH. The details are in [benchmark.md](benchmark.md); the
plain-language version of digests is in [digests.md](digests.md).

## Why memory exists

The retired OptMem prototype exposed the gap: native DSH forgets everything between threads (0/12 cross-session
probes), while the historical memory pilot recovered 9/12 (details in [benchmark.md](benchmark.md)). OptMem paid for it twice:

- it summarized every event as it arrived, mostly into nodes nobody read;
- it rewrote the live context, which broke the provider's prefix cache.

Compat cost 1.6–3.2× native per thread. `@dshfiles/memory` keeps the recall and drops both costs.

## Design, and why

| choice                                                                                                                                           | why                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DSH's own session logs are the store; memory keeps only digests, notes and a contentless FTS index                                               | No capture pipeline to keep in sync, nothing copied. Excerpts are read back from the log on demand.                                                                                                                                             |
| One digest per thread, built when it has been idle 60 s                                                                                          | Never during a turn. Deterministic from the thread's trail (user requests, verbatim corrections, todos, goal, jj descriptions, final answer) via dshx's `digestSession`. A cheap model (reasoning off) runs only when the thread left no trail. |
| A start block appended to the end of the system prompt, frozen per thread                                                                        | It sits in the cached prefix and is never re-emitted. Every thread of a project gets the same bytes until memory changes, so the prefix cache spans threads. In the benchmark it appeared once per request, in `system#0`, and nowhere else.    |
| Pointers, not content, in the block (1.6 KB budget)                                                                                              | Notes and thread ids ranked by citations then recency. The agent pulls details with `memory_search` / `memory_read` only when it needs them.                                                                                                    |
| Two levels: digest, then raw excerpt; no summary tree, no roll-up                                                                                | BM25 already finds 24/25 natural recall questions at 5,000 items. A roll-up is designed (README) but not built.                                                                                                                                 |
| Notes are the agent's job (`memory_note`), typed like Claude Code (`user`, `feedback`, `project`, `reference`) with scope, confidence and source | Corrections and decisions get recorded deliberately. Update supersedes and forget hides, both with a reason, so stale facts are replaced instead of piling up. The digest keeps the user's corrections verbatim as a backstop.                  |
| `memory: <id>` citations                                                                                                                         | The usefulness signal: they rank the block and count tool calls as used.                                                                                                                                                                        |
| Subagents get the same block and tools                                                                                                           | They pay the same small cost and benefit the same way.                                                                                                                                                                                          |

## Native vs memory vs compat

18 runs: support, logs and the long infra-rollout scenario, two repetitions each. OpenCode Go DeepSeek V4.1 Flash,
summaries and digests with reasoning off. **The memory arm ran with Jev off.**

| arm        | if native costs $1 | of which digests / summaries |      Jev | agent cache-read | cross-session recall | same-session recall | infra hand-off acceptance |
| ---------- | -----------------: | ---------------------------: | -------: | ---------------: | -------------------: | ------------------: | ------------------------: |
| native     |              $1.00 |                            – |        – |            93.4% |                 0/12 |               36/38 |                      0/16 |
| **memory** |          **$1.18** |                       $0.016 | $0 (off) |            90.9% |            **11/12** |               37/38 |                 **15/16** |
| compat     |            ≥ $2.54 |                      ≥ $1.38 |        – |            89.9% |                10/12 |               38/38 |                     14/16 |

- **Memory's own cost is its digests: 0.3–5% of native.** The rest of the 1.18× is agent-loop variance. In the first
  thread of each scenario memory is empty and the configuration is identical to native, yet costs differed by up to
  1.6×.
- **On the long scenario memory was cheaper than native (0.67×).** Native spent its later threads rebuilding context
  from files and still failed the hand-off. Memory passed 15/16.
- **Compat is a lower bound.** Two of its runs did not finish summarizing within 600 s.

## Jev

Optional, off by default. As a recall gate on 13 thread openers, it was right on 12; its one miss would have hidden
thread pointers from a thread that needed them. It costs nearly nothing (96 calls for $0.0017, p50 199 ms). The miss is
why it stays opt-in.

## Retrieval: BM25 vs hybrid

5,000 synthetic digests and notes plus the scenarios' recall probes. Recall@5:

| ranker                      | exact identifiers | paraphrases (adversarial) | natural questions |               search p95 |
| --------------------------- | ----------------: | ------------------------: | ----------------: | -----------------------: |
| **BM25** (porter + trigram) |       **101/101** |                      0/67 |         **24/25** |                    16 ms |
| hybrid, bge-small-en-v1.5   |           101/101 |                     11/67 |             24/25 |    54 ms + 7 ms to embed |
| hybrid, EmbeddingGemma-300m |           101/101 |                     23/67 |             24/25 | 175 ms + 331 ms to embed |

Hybrid only helps paraphrases written to share no word with their answer, and costs a 34–309 MB model. BM25 is the
default; hybrid is a setting that runs only with an embedding provider you install (no dependency added).

## What's configurable

`dshfiles-memory` settings (Plugins page):

- `enabled`;
- `crossProject`;
- `blockBytes` and `blockStaleDays`;
- `idleMs`;
- the digest route: `summarizerProvider` / `summarizerModel` / `summarizerEffort`, and `cheapModels`;
- `retrieval` (`bm25` | `hybrid`) and `embeddingProvider`;
- `jevEnabled` and `jevThreshold`;
- `retentionDays`.

The model-facing wording (start-block instruction, tool descriptions) lives in `src/guidance.ts`.

The Memory panel (sidebar) shows:

- notes with their source, which can be edited or forgotten, with their history;
- thread digests by project;
- usage: cost per day, start-block size and how many requests carried it, recall hits and citations, the correction
  heuristics, and 👍/👎 per cited memory.

## Open questions

1. **Does it earn its keep day to day?** The citation and correction counters will tell; the benchmark only measured
   scripted probes.
2. **Note quality.** Agents chose sensible types and scopes in the live check. Whether they over-note, or note one-off
   requests as global preferences, needs a few weeks of real threads and the panel's ratings.
3. **The 60 s idle wait** means a thread opened right after another one may not see its digest. The message index
   still finds the content, but the block won't point at it.
4. **Weighted fusion.** Equal-weight RRF lets the BM25 lists outvote one vector list. Weight the vector list if hybrid
   is ever adopted.
5. **No message-level deep link.** DSH's `openSession` takes no event sequence, so a source link opens the thread but
   cannot scroll to the message.
6. **Promoting recurring notes into AGENTS.md or skills** is out of scope, and the natural next feature.
