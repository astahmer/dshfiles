# OptMem summaries without reasoning — benchmark 2026-10-13

Question: OptMem compatibility mode gives cross-session recall, but it costs about 2.5× native list price, and the
summarizer is most of that cost. In long pilots, 59–71% of DeepSeek V4.1 Flash summary calls hit the output cap. The
provider reported 0 reasoning tokens, yet each run streamed 450–760 KB of reasoning text. Hypothesis: hidden reasoning
fills the output budget, and turning it off removes most of the waste without hurting summary quality.

The answer is yes for cost, completion and backlog. There is one quality trade-off: more summaries get byte-clipped (see
below).

## Setup

| item    | value                                                                                                                                                                                   |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime | stock DSH 0.2.0-rc.2 with scratch `DSH_HOME`s on ports 3241–3248. The live Host on 3080 and `~/.dsh` were not touched                                                                   |
| agent   | `opencode-go-alex` → `deepseek-v4.1-flash` at the adapter default effort, with the native 1M context and stock compaction (nothing forced)                                              |
| harness | [`bench/`](../bench/): `run-arm.mjs` with the production-aligned calibration (`--calibration`), long scenarios `infra-rollout` and `product-support` (68 turns, 3 sessions)             |
| prices  | pi-ai catalog list prices. DeepSeek V4.1 Flash: $0.15 / $0.003 cached / $0.60 per M. gpt-6-luna: $0.10 / $0.01 / $0.50. These are list-price estimates; both accounts are subscriptions |
| load    | the machine ran the user's apps and other agents (load average 7–56). Wall-clock and latency figures are noisy                                                                          |

### How `off` reaches DeepSeek

DeepSeek's API turns thinking off with `thinking: {type: "disabled"}`. Its `reasoning_effort` accepts only `low`, `high`
and `max`, and `minimal` maps to `low`. A direct call through OpenCode Go accepted `disabled` and returned 0 reasoning
tokens. `low` reasoned about as much as the default (84 vs 76 reasoning tokens on a one-line prompt).

pi-ai's catalog marks `off` as unsupported for `deepseek-v4.1-flash` on OpenCode Go, so DSH refused it
(`UNSUPPORTED_REASONING_EFFORT`). `@dshfiles/ai-accounts` now offers `off` on that route. Offering `off` makes pi-ai send
`disabled` whenever a request names no effort, so requests that omit an effort now carry DeepSeek's documented default
(`high`) explicitly. A side observation: `deepseek-v4-flash` on the same route already had `off` in its catalog, so a
request with no effort already runs it without thinking. That behavior is unchanged.

## 1. Direct calibration (production prompt, 512-byte nodes, 3 repetitions)

Five variants on the same four cases. The cases include the 1,784-byte long leaf with three named owners. The
`max-tokens` cap starts at 2,048 tokens with one retry at 4,096. "Complete" means a summary came back. "Quality" uses the
harness's strict substring probes.

| variant (route, effort)             | complete | strict quality | long leaf complete | max-token finishes | output tok | streamed reasoning | mean ms | list $ |
| ----------------------------------- | -------: | -------------: | -----------------: | -----------------: | ---------: | -----------------: | ------: | -----: |
| baseline: DeepSeek, adapter default |     9/12 |           6/12 |                0/3 |                  6 |     21,954 |              66 KB |   9,138 | 0.0137 |
| DeepSeek, `low`                     |     9/12 |           8/12 |                0/3 |                  6 |     22,094 |              69 KB |   9,446 | 0.0138 |
| **DeepSeek, `off`**                 |    12/12 |           8/12 |                3/3 |                  0 |      2,660 |                  0 |   3,364 | 0.0026 |
| Codex Alex2 `gpt-6-luna`, `off`     |    12/12 |           6/12 |                3/3 |                  0 |      2,657 |                  0 |   4,384 | 0.0022 |
| Codex Alex2 `gpt-6-luna`, `low`     |    12/12 |           7/12 |                3/3 |                  0 |      2,370 |                  0 |   4,490 | 0.0020 |

- Both reasoning variants spent the full 6,144-token budget (2,048 + 4,096) on the long leaf in every repetition and returned no text. That is 84% of their output tokens.
- The strict probe fails every completed long-leaf summary because its phrase aliases are narrow (it misses "37-min soak" and "Birch 2% … then Cedar 8%"). A fixed regex audit of 12 key facts, applied to all variants, gave:
  - DeepSeek `off`: 11, 12 and 12 of 12, with all three owners' full names in 3/3 runs.
  - Luna `off`: 11, 9 and 12. Luna `low`: 12, 12 and 9.
  - Each Luna variant dropped every surname in 1 of 3 runs, and Luna also dropped "Elin Moss" or "preflight has not run" in 2–3 of 3 support summaries.
- Luna is slightly cheaper but loses identities more often. It also spends ChatGPT-plan quota: across both Luna variants, 16.6k input and 5.0k output tokens. The 5-hour window moved from 19% to 20% used and the weekly window stayed at 7%. Other clients share that account, so these quota numbers are approximate.
- A follow-up calibration (5 cases, 3 repetitions) added a merge of two notes already at the 512-byte ceiling and two prompt hints for the unreasoned model:

  | variant                     | completion | first answers over 512 B | mean answer bytes |
  | --------------------------- | ---------: | -----------------------: | ----------------: |
  | DeepSeek `off`, no hint     |      15/15 |                    11/23 |               586 |
  | hint "about N words"        |      15/15 |                     3/17 |               371 |
  | hint "aim for N characters" |      15/15 |                     9/21 |               459 |

  The word hint cut overshoot, but its shorter notes dropped the owners' surnames in 2 of 3 long-leaf runs. Production keeps the unhinted prompt.

**Decision:** for OpenCode Go summaries the default effort is now `off`, with routing unchanged (`cheapModels`). Luna is
not adopted.

## 2. End-to-end: long realistic scenarios

Arms:

- **native**: OptMem not loaded.
- **compat-old**: compat mode with the summarizer forced to DeepSeek at the adapter default, the old behavior.
- **compat-new**: compat mode with default routing, which now uses `off`.
- **full-new**: full mode with `off` (one repetition, budget allowing).

Each arm ran 2 repetitions per scenario, with seeds paired across arms. Every run completed 68/68 turns. Three runs
failed during a load spike (load average 56, Host stream timeout) and were rerun; the failed attempts are archived and
excluded.

| scenario        | arm        | cross-session recall | same-session recall | negative/refusal | task acceptance | total $ (r1 / r2) |     summary $ | summary calls (capped) | summaries stored (clipped) | backlog at 600 s drain              | wall min |
| --------------- | ---------- | -------------------: | ------------------: | ---------------: | --------------: | ----------------: | ------------: | ---------------------: | -------------------------: | ----------------------------------- | -------: |
| infra-rollout   | native     |                  0/6 |                 5/6 |              4/4 |           12/16 |     0.243 / 0.280 |             – |                      – |                          – | –                                   |   28, 25 |
| infra-rollout   | compat-old |                  6/6 |                 6/6 |              4/4 |           14/16 |    0.654 / 0.345¹ | 0.343 / 0.166 |   237 (155) / 141 (45) |          97 (28) / 74 (16) | **not drained**: 538 / 506 leaves   |   40, 47 |
| infra-rollout   | compat-new |                  5/6 |                 6/6 |              4/4 |           14/16 |     0.479 / 0.443 | 0.271 / 0.279 |      775 (0) / 844 (0) |      609 (359) / 612 (336) | drained in 443 s / 116 leaves left  |   28, 28 |
| infra-rollout   | full-new   |                  3/3 |                 3/3 |              2/2 |             7/8 |             0.507 |         0.317 |               1091 (1) |                  878 (499) | drained in 368 s                    |       43 |
| product-support | native     |                  0/6 |                 4/6 |              3/4 |           14/16 |     0.201 / 0.165 |             – |                      – |                          – | –                                   |   25, 15 |
| product-support | compat-old |                  3/6 |                 4/6 |              4/4 |           16/16 |    0.497 / 0.719¹ | 0.304 / 0.291 |   190 (144) / 231 (84) |         44 (13) / 100 (31) | **not drained**: 500 / 1,002 leaves |   32, 53 |
| product-support | compat-new |                  4/6 |                 4/6 |              4/4 |           16/16 |     0.680 / 0.508 | 0.324 / 0.321 |      973 (0) / 985 (0) |      805 (432) / 757 (423) | drained in 272 s / 567 s            |   39, 25 |

¹ Lower bound: the old summarizer left 500–1,002 leaves unsummarized at the drain deadline, so finishing its work would
have cost more.

Totals across 8 compat runs:

| metric                     | compat-old                      | compat-new      |
| -------------------------- | ------------------------------- | --------------- |
| capped summary calls       | 428/799 (54%)                   | 0/3,577         |
| streamed reasoning         | 5.3 MB                          | 0               |
| summary output tokens      | 1.69 M                          | 0.71 M          |
| summary list cost per node | $0.0022–0.0069 (mean ≈ $0.0035) | $0.0004–0.00046 |
| drained within 600 s       | 0/4 runs                        | 3/4 runs        |

Per stored summary node, the new summarizer is 5–17× cheaper, and it actually finishes the work. For the same summary
spend ($0.17–0.34 per run) it produced 6–18× more summary nodes.

## Findings

1. **Hidden reasoning was the waste.** With reasoning off, no summary call hit the output cap in 3,577 calls (versus 54%
   with reasoning), and no reasoning text was streamed. The backlog that never drained before now drains in 4.5–9.5
   minutes. The exception is one infra repetition, which left 116 leaves at the deadline under heavy machine load.
2. **Quality held on the probes, with a new caveat.** Cross-session recall was 9/12 for both compat arms (0/12 native).
   Same-session recall, refusals and task acceptance matched compat-old. The caveat: an unreasoned model does not respect
   the byte budget (median answer 812 B against 512 B). Merges stop after one overshoot, so about 55% of new summary
   nodes are byte-clipped at the tail, versus about 29% of the far fewer old nodes. The probes did not catch any loss from
   this, but it is real information loss. A follow-up task was filed to try a cheap bounded merge retry now that calls
   cost ~10× less.
3. **Native still costs least, and the gap is now mostly the agent loop.** compat-new averaged 1.8× native list cost on
   infra ($0.46 vs $0.26) and 3.2× on product-support ($0.59 vs $0.18). About $0.27–0.32 of that is summaries; the rest is
   agent-loop variance. Agent cost swings ±40% between repetitions of the same arm, depending on how many tool steps the
   model takes and on cache hits. The compact view is rewritten more often when summaries actually complete, and the
   agent's cache-read share was 76–84% under compat-new against 93–98% under native. That plausibly costs cache hits but
   was not isolated.
4. **Full mode** (one repetition) matched compat-new quality, sent the smallest agent prompts (4.7 M vs 8–9 M prompt
   tokens), and spent more on summaries ($0.32). Its total ($0.51) is in compat-new's range. One run is not enough to rank
   it.
5. **Native-only loses every cross-session question** (0/12) while matching same-session work. Inside one session, the 1M
   context window makes OptMem unnecessary.

## Recommendation: is OptMem worth it?

- **Keep compat mode on**, now with summary reasoning off. It is the only arm that answers questions from earlier
  sessions (9/12 vs 0/12). With this change it finishes its summary work and costs about $0.25–0.40 more than native per
  68-turn, ~800 KB conversation at list price, which is roughly 2× native. Before this change it cost about the same or
  more and left 500–1,000 leaves unsummarized.
- **Do not switch the default to full mode yet.** One repetition shows parity at similar cost and is not evidence of a
  gain.
- **Turn OptMem off** only for single-session, throwaway work, where native compaction with a 1M window already does
  the job for less.

## Reproduce

```sh
# calibration: arm A, no live memory engine
node plugins/@dshfiles/optmem/bench/run-arm.mjs --arm A --scenario scenarios/summary-calibration.json --port 3241 \
  --out <dir> --calibration --calibration-variants baseline-default,low-effort,thinking-off,luna-off,luna-low \
  --calibration-limit 4 --calibration-reps 3
# long runs: compat-old forces the previous route, compat-new uses default routing
BENCH_SUMMARY_PROVIDER=opencode-go-alex BENCH_SUMMARY_MODEL=deepseek-v4.1-flash \
  node plugins/@dshfiles/optmem/bench/run-arm.mjs --arm B --scenario scenarios/infra-rollout.mjs --rep 1 \
  --variant long --drain-ms 600000 --port 3244 --out <dir>/compat-old
```

Total spend for this study, including failed attempts: about $6.8 list price on OpenCode Go, plus 21.6k tokens on the
Codex Alex2 ChatGPT plan. Scratch homes and copied credentials were deleted after each run, and raw transcripts are not
published.
