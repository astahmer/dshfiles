# @dshfiles/memory — benchmark 2026-10-14

> Historical results. The comparative OptMem harness and its scenario runners are retired; these measurements cannot be
> reproduced from the current checkout.

Question: OptMem's compatibility mode bought cross-session recall (9/12 vs 0/12 native) at 1.8–3.2× native cost,
because it summarizes every event and re-emits its memory view mid-context. Does `@dshfiles/memory` keep the recall
for close to native cost?

## Setup

| item      | value                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| runtime   | stock DSH 0.2.0-rc.2, scratch `DSH_HOME`s (profile shape from the checked-in `profiles/web`), two Hosts in parallel; the live Host on 3080 and `~/.dsh` were not touched |
| agent     | OpenCode Go DeepSeek V4.1 Flash at the adapter default effort, native 1M context and stock compaction (the scenarios' own compaction policy)                             |
| account   | `opencode-go-pi`: the `opencode-go-alex` key in the vault answers _Invalid credential_ upstream, so the same model ran on the Pi subscription                            |
| summaries | memory digests and OptMem summaries on the thread's cheap route, DeepSeek V4.1 Flash with reasoning `off`                                                                |
| arms      | **native** (neither plugin), **memory** (`@dshfiles/memory`, defaults, Jev off), **compat** (OptMem compatibility as on main)                                            |
| scenarios | `support` (28 + 2 turns, 2 threads), `logs` (24 + 1, 2 threads), `infra-rollout` long (68 turns, 3 threads, acceptance tests); 2 repetitions each, seeds paired          |
| harness   | Retired OptMem harness, arm M; between threads it waited for the previous digest (idleMs 60 s), as a pause between threads would                                         |
| prices    | list prices: /bin/zsh.15 / /bin/zsh.003 cached / /bin/zsh.60 per M tokens                                                                                                |
| load      | load average 15–60 (other agents and the embedding experiment); wall times are noisy                                                                                     |

Total list spend for the 18 runs: .49.

## End to end: native vs memory vs compat

| scenario      | arm    | runs | $ per run | vs native | agent | digest / summary | Jev | agent cache-read | cross-session | same-session | analysis | acceptance | block in system only                                 |
| ------------- | ------ | ---: | --------: | --------: | ----: | ---------------: | --: | ---------------: | ------------: | -----------: | -------: | ---------: | ---------------------------------------------------- |
| infra-rollout | native |    2 |     0.300 |      1.00 |  1.00 |            0.000 |   0 |            92.6% |           0/6 |          4/6 |      0/0 |       0/16 | –                                                    |
| infra-rollout | memory |    2 |     0.200 |      0.67 |  0.66 |            0.003 |   0 |            95.4% |           5/6 |          6/6 |      0/0 |      15/16 | 118/270 calls carry it; 0 outside system, 0 repeated |
| infra-rollout | compat |    2 |     0.388 |      1.29 |  0.57 |            0.724 |   0 |            90.5% |           4/6 |          6/6 |      0/0 |      14/16 | –                                                    |
| logs          | native |    2 |     0.056 |      1.00 |  0.87 |            0.000 |   0 |            92.0% |           0/2 |        12/12 |    16/16 |          – | –                                                    |
| logs          | memory |    2 |     0.064 |      1.14 |  0.96 |            0.000 |   0 |            89.4% |           2/2 |        11/12 |    16/16 |          – | 6/118 calls carry it; 0 outside system, 0 repeated   |
| logs          | compat |    2 |     0.129 |      2.31 |  1.02 |            1.034 |   0 |            90.2% |           2/2 |        12/12 |    16/16 |          – | –                                                    |
| support       | native |    2 |     0.016 |      1.00 |  0.99 |            0.000 |   0 |            95.7% |           0/4 |        20/20 |      4/4 |          – | –                                                    |
| support       | memory |    2 |     0.028 |      1.73 |  1.59 |            0.046 |   0 |            88.0% |           4/4 |        20/20 |      4/4 |          – | 7/64 calls carry it; 0 outside system, 0 repeated    |
| support       | compat |    2 |     0.064 |      4.02 |  1.52 |            2.393 |   0 |            89.1% |           4/4 |        20/20 |      4/4 |          – | –                                                    |

If native costs $1:

| arm    | if native costs $1 | agent | digest / summary | Jev | agent cache-read | cross-session | same-session |
| ------ | -----------------: | ----: | ---------------: | --: | ---------------: | ------------: | -----------: |
| native |              $1.00 | $0.95 |           $0.000 |  $0 |            93.4% |          0/12 |        36/38 |
| memory |              $1.18 | $1.07 |           $0.016 |  $0 |            90.9% |         11/12 |        37/38 |
| compat |              $2.54 | $1.04 |           $1.384 |  $0 |            89.9% |         10/12 |        38/38 |

Agent cost by thread. The first thread starts with empty memory, so memory and native run the same configuration
there; any gap is run-to-run noise. The later threads are where the start block and the tools act:

| scenario      | arm    | agent $ first thread | agent $ later threads | agent cache-read, later threads |
| ------------- | ------ | -------------------: | --------------------: | ------------------------------: |
| infra-rollout | native |               0.0691 |                0.2303 |                           94.3% |
| infra-rollout | memory |               0.0974 |                0.1012 |                           96.9% |
| infra-rollout | compat |               0.0542 |                0.1164 |                           90.9% |
| logs          | native |               0.0475 |                0.0011 |                            3.8% |
| logs          | memory |               0.0509 |                0.0030 |                           34.8% |
| logs          | compat |               0.0560 |                0.0012 |                           74.5% |
| support       | native |               0.0152 |                0.0007 |                           76.4% |
| support       | memory |               0.0238 |                0.0016 |                           70.2% |
| support       | compat |               0.0232 |                0.0010 |                           70.1% |

Notes:

- **Recall.** Memory answered 11/12 cross-session probes (compat 10/12, native 0/12) and 37/38 same-session probes.
  The cross-session miss found the right values (37 min, 7.3.2) with `memory_search` but also quoted the
  superseded ones, which the probe forbids. The same-session miss (`logs`, 14:20 for 14:19) used no memory tool.
- **Block placement.** In every agent request that carried the start block, it sat in the system message
  (`system#0`), exactly once (0 outside the system message, 0 repeated). First threads carry none: memory was empty.
- **Digest cost.** Digests cost $0.0006–0.0011 per run: one cheap call where the first thread left no trail (a
  short final answer and no todos or revisions), none in `logs`. That is 0.3–5% of native. The rest of memory's
  ratio is agent-loop variance.
- **Variance.** Support's 1.73× is first-thread noise: $0.024 vs $0.015 on identical configurations. On
  infra-rollout, memory was _cheaper_ than native (0.67×). Native threads 2–3 spent $0.23 on tool steps trying to
  rebuild context from files and still failed the hand-off (0/16 acceptance). Memory spent $0.10 there and passed
  15/16.
- **Compat is a lower bound.** Two compat runs (`infra-rollout-B-r1`: 350 leaves; `support-B-r2`: 1 view) did not
  drain within 600 s, so their summary work is under-counted.
- **Acceptance** shows the raw pass counts of the hand-off tests. The OptMem report zeroes a run that misses any test.
- **Cache reads.** The agent's cache-read share was 90.9% for memory, 89.9% for compat and 93.4% for native, pooled
  per scenario. In later threads memory read 96.9% from cache on infra-rollout, against 94.3% native and 90.9% compat.

## Live check: the whole loop on a real model

The three-thread, one-project live check used the retired OptMem harness, arm M:

| thread | what happened                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1      | The agent wrote `NOTES.md` and described the jj revision, then the user corrected 72 → 96 h. No block (memory empty). Digest built from the trail 9 s after the thread went idle, no model call.                                                                                                                                                                                                                                                                     |
| 2      | First request carried the block in the system message (`system#0`) and nowhere else, on every step. The agent called `memory_search` then `memory_read`, answered "96 hours, `retention_hours`" and cited `memory: t:5c27d6a5`; both calls were counted as used. Then it saved `n:1` (type `user`, scope `global`, source message `#29`, origin "user asked to remember") with `memory_note`. This thread had no trail of its own, so its digest was one cheap call. |
| 3      | Answered from the note in its start block without any tool call and cited `memory: n:1`.                                                                                                                                                                                                                                                                                                                                                                             |

## Retrieval: BM25 vs local embeddings vs hybrid

`bench/retrieval.ts` seeds 5,000 synthetic digests and notes over 40 projects, plus the user prompts of the support,
infra-rollout and product-support scenarios as distractors and answers. Recall@5 on three sets:

- **exact:** 101 synthetic identifier questions.
- **paraphrase:** 67 synthetic topic questions sharing no rare word with their digests. This set is adversarial by
  construction.
- **natural:** the 25 recall and cross-session probes of those scenarios whose answer sits in a user prompt.

| ranker                           | model                                                             |       exact | paraphrase |   natural | search p50 / p95 ms | query embedding p50 ms |
| -------------------------------- | ----------------------------------------------------------------- | ----------: | ---------: | --------: | ------------------: | ---------------------: |
| **BM25 (porter + trigram, RRF)** | —                                                                 | **101/101** |       0/67 | **24/25** |            4.9 / 16 |                      — |
| vector                           | bge-small-en-v1.5 q8 (34 MB, MIT, English)                        |      75/101 |      28/67 |     22/25 |             25 / 87 |                      8 |
| hybrid RRF                       | bge-small-en-v1.5 q8                                              |     101/101 |      11/67 |     24/25 |             23 / 54 |                      7 |
| vector                           | EmbeddingGemma-300m q8 @256 (309 MB, Gemma licence, multilingual) |      91/101 |      41/67 |     18/25 |             26 / 91 |                    178 |
| hybrid RRF                       | EmbeddingGemma-300m q8 @256                                       |     101/101 |      23/67 |     24/25 |            39 / 175 |                    331 |

Indexing the 5,136 documents took 118 s (bge) and 608 s (Gemma) on a loaded machine (load average 20–60).

**Decision: BM25 stays the default; embeddings stay an optional, pluggable ranker.**

- Hybrid gains only on the adversarial paraphrase set (+11 to +23 of 67).
- It changes nothing on the natural probes (24/25 either way) or on identifiers (101/101).
- Its price is a 34–309 MB model, a native ONNX runtime, and 7–330 ms per query.
- The store already keeps vectors per (kind, ref, model) and fuses them by reciprocal rank (`ranker: 'hybrid'`).

Dependencies for approval, if hybrid is wanted later: `@huggingface/transformers@4.3.1` (Apache-2.0; pulls
`onnxruntime-node`, 482 MB installed). Model choice: EmbeddingGemma (Gemma licence, multilingual, French notes) or
bge-small-en-v1.5 (MIT, English only). Neither was added to the repository; the prototype ran from a scratch directory.

The one natural miss is the same for every ranker. A plain equal-weight RRF lets the four BM25 lists outvote the
single vector list; that is why hybrid paraphrase recall sits below vector-only. A weighted fusion is the next lever if
embeddings are adopted.

**Per-project roll-up: designed, not built.** Search does not need it at this scale, and a summary would not help the
paraphrase misses either. See the [README](../README.md#per-project-roll-up-designed-not-built).

`src/scale.test.ts` keeps the scale bound in CI: 5,000 items, search p95 < 150 ms, and a block within its byte budget.

## Jev (optional, off by default)

`bench/jev-eval.ts` ran on the user messages of the five scenarios: 96 calls, 40,483 input tokens, **$0.0017** in
total, latency p50 199 ms and p90 242 ms.

- **Recall gate:** 12 of 13 thread openers classified right. 7 of 8 that need memory were flagged, and 5 of 5 that
  do not were left alone. The one false negative would have dropped thread pointers from a thread that needed them.
- **Signals:** Jev flagged 21 of 83 short user messages, the phrasing heuristics 6; both agreed on 4.

Jev costs nearly nothing, but the gate's single miss loses recall. That is why it stays opt-in, and why the end-to-end
memory arm ran without it (Jev $0).

## Current verification

The captured end-to-end and Jev results above are historical; reproducing them would require the retired prototype's
runner and evaluation corpus. Current Memory behavior is covered by its tests:

```sh
pnpm --dir plugins/@dshfiles/memory typecheck
pnpm --dir plugins/@dshfiles/memory test
```
