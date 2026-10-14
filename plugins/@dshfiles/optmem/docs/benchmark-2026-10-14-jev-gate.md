# Fewer OptMem summaries: summary reuse, rule gate, Jev gate — benchmark 2026-10-14

Question: OptMem's cost is its summarizer. Can it make fewer summary calls without losing what recall depends on?
Three levers were measured:

- **Exact-input reuse.** An engine memo answers a repeated summary request from the first result.
- **A deterministic rule gate.** Regenerable tool output is stored as a short structural note instead of being summarized.
- **TypeSafe's Jev classifier.** Jev decides which leaves are worth a summary, alone or behind the rules.

**Verdict.**

- **Adopt reuse and the rule gate. Do not adopt Jev.** On tool-heavy runs, reuse plus rules make 40–63% fewer summary
  calls than today's code. No probe value was lost offline and no failure in the end-to-end runs is attributable to them.
- **Jev agrees with the rules but adds almost nothing.** It removes 0–3 more points, needs an external key, and on its
  own it skips large user messages.
- **Jev stays available opt-in** and fails open when the key is missing or the call errors or times out.

> **All end-to-end arms ran with summary reasoning ON** (adapter default, pre-`off` code). `main` now defaults OpenCode
> Go summaries to reasoning `off`, which makes each summary 5–17× cheaper
> ([summary-reasoning benchmark](benchmark-2026-10-13-summary-reasoning.md)). Call-count savings carry over; dollar
> savings shrink by that factor.

> **Not landed.** The reuse memo, rule gate and Jev client below were never merged: OptMem's live modes were retired in favour of `@dshfiles/memory` (see [findings](findings.md)). This report is kept for its measurements.

## What changed

| change                                                                                                                                                                                | where                            | default                  |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | ------------------------ |
| Memo of identical summary requests (2,048 entries, in-process). A project stream repeats its conversation's tree, so identical merge inputs reached the summarizer twice              | `optmem-core` engine             | always on                |
| `leafGate` hook: an over-budget leaf may become a note instead of a summary call. A failing gate falls back to summarizing. Status reports `reuses`, `gatedLeaves` and `gateFailures` | `optmem-core` engine             | —                        |
| Rules, see the next section                                                                                                                                                           | `optmem/src/summary-gate.ts`     | `summaryGateRules: true` |
| Jev on what the rules leave undecided (`POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer $TYPESAFE_API_KEY`, one Noul, threshold 0.5, 2 s timeout)                  | `optmem/src/summary-gate-jev.ts` | `summaryGateJev: false`  |

What the rules do:

- **Always summarized:** user and assistant turns, and tool errors.
- **Stored as a ≤240 B note:**
  - file reads (path and line count);
  - edit and write calls (path and head of the new text);
  - other long tool calls;
  - search and glob hits;
  - passing test logs (summary lines);
  - directory listings;
  - diffs (files and +/− counts);
  - memory-tool results.
- **Left undecided:** any other tool output. Without Jev, it is summarized.

In every case the raw event stays stored, searchable and zoomable.

**Jev API facts** ([docs](https://docs.typesafe.ai/api)):

- **Model and price:** model `jev-latest` resolves to `jev-1.13.0`. It costs $0.042 per million input tokens; output is free.
- **Limits:** 100k tokens/s and 80 requests/s; 64k tokens per request (32k for the state).
- **Latency and spend:** measured p50 was 242–244 ms and p90 357–424 ms. The study's 851 offline classifications cost
  $0.04 in total.

## 1. Offline: replaying recorded runs through the real engine

`bench/gate-eval.mjs` replays recorded memory databases through `createMemoryEngine` with SQLite and a fixed-size fake
summarizer. It counts leaf and merge calls, and checks whether each probe's expected value still appears in what the
memory keeps (summaries are assumed to keep their input — an optimistic assumption, equal across arms).

- **Tuning set:** 6 compat runs of the [2026-10-13 benchmark](benchmark-2026-10-13.md).
- **Holdout:** 6 full-mode runs from the same benchmark.

| arm                      | tuning: calls | vs old | holdout: calls | vs old | probe values lost |
| ------------------------ | ------------: | -----: | -------------: | -----: | ----------------: |
| old engine (no reuse)    |         1,869 |      — |          2,883 |      — |             0/108 |
| reuse only               |         1,125 |   −40% |          1,628 |   −44% |             0/108 |
| reuse + rules            |           836 |   −55% |          1,151 |   −60% |             0/108 |
| reuse + Jev only @0.5    |           801 |   −57% |          1,139 |   −60% |             0/108 |
| reuse + rules + Jev @0.5 |           799 |   −57% |          1,095 |   −62% |             0/108 |

- **Merges dominate:** 79% of old calls were merges. Reuse removes the duplicated half of them, at zero risk by
  construction.
- **The rules gate about half the oversized leaves** (389 → 183 on the tuning set; 586 → 208 on the holdout). Smaller
  notes (120/160 B) only gained 2–3 more points, so 240 B was kept.
- **Jev scores confirm the rules.** Every file read, edit, diff and search-hit leaf scored < 0.5, almost all < 0.3.
  Analysis-style bash output scored 0.5–0.9.
- **Jev only skips 21/75 (tuning) and 40/99 (holdout) undecided leaves**, worth 0–3 points of total calls.
- **Jev-only also skipped large user and assistant turns:** 6/12 user and 6/96 assistant (tuning), 6/12 and 10/97
  (holdout). Those user turns are pasted documents that carry facts. That is the reason not to run Jev without the rules.

## 2. End-to-end: logs and support, two repetitions per arm

**Setup:**

- **Route:** `opencode-go-alex` → DeepSeek V4.1 Flash, scenario compaction policy (32k), compat mode, scratch homes.
- **Arms:** `base` is the pre-change code in a scratch workspace; the other arms are this revision with the named gate.
- **Load:** the machine ran other agents (load average up to 119). Three runs died on a Host stream timeout and were
  rerun. Runs went serial after that.
- **Not finished:** no run drained within 600 s, because reasoning-on summaries took 15–40 s each.

**How the cost columns are computed:**

- **Summaries ($):** projected to a fully drained queue. It is the measured $ per completed summary in that run × the
  summaries required, where the required count comes from replaying the run's own events under its arm.
- **Native reference:** native was not rerun. Its figures come from arm A of [2026-10-13](benchmark-2026-10-13.md),
  same scenarios: logs $0.080, support $0.022, agent cache-read 90–93%.

| scenario | arm         | native $1 → this | agent | summaries (projected) |    Jev | agent cache-read | summaries avoided vs old | leaves noted | recall same / cross | drained       |
| -------- | ----------- | ---------------: | ----: | --------------------: | -----: | ---------------: | -----------------------: | -----------: | ------------------- | ------------- |
| logs     | base (old)  |              5.4 | 0.055 |                 0.376 |      — |              90% |                        — |            0 | 28/28, 2/2          | no (129 left) |
| logs     | rules       |          **4.0** | 0.073 |                 0.244 |      — |              89% |                      48% |           25 | 28/28, 2/2          | no (121)      |
| logs     | rules + Jev |              4.9 | 0.067 |                 0.321 | 0.0006 |              91% |                      51% |           52 | 28/28, 2/2          | no (80)       |
| logs     | Jev only    |              4.0 | 0.058 |                 0.259 | 0.0023 |              92% |                      51% |           38 | 27/28¹, 2/2         | no (103)      |
| support  | base (old)  |             16.8 | 0.020 |                 0.348 |      — |              94% |                        — |            0 | 24/24, 4/4          | no (48)       |
| support  | rules       |         **11.2** | 0.024 |                 0.222 |      — |              91% |                      40% |            1 | 24/24, 4/4          | no (59)       |
| support  | rules + Jev |             11.6 | 0.026 |                 0.228 | 0.0000 |              92% |                      42% |            7 | 24/24, 4/4          | no (2)        |
| support  | Jev only    |              9.9 | 0.030 |                 0.186 | 0.0008 |              89% |                      45% |          12² | 24/24, 4/4          | no (4)        |

¹ `recall-rotation` answered 14:20 instead of 14:19. The fact was still in 8 memory nodes and verbatim in the user leaf,
so this is an agent answer, not a gate loss.

² 8 of these were user and assistant turns.

**Reading the table:**

- **Within-run ratios are the robust signal.** Replaying each run's own events gives reuse −36% to −43% everywhere, and
  rules a further −12% to −23% on logs, −36% on coding and −2% on support.
- **Arm-to-arm $ swings with how much the agent did.** Agent cost varies ±40% between repetitions, and the summarizer's
  per-call cost (reasoning on, 30–56% of calls capped) is noisy.
- **Coding, one run per arm, diagnostic only.** Base timed out on turn 13. Rules: 22/22 turns, acceptance 8/9 (the agent
  named a new error `LL_QUANTITY_INVALID_LINE` while the spec says `LL_INVALID_LINE`, after 4–7 native compactions per
  turn). Jev only: 9/9. Replay: rules make 63% fewer calls than old, Jev-only also 63%.
- **Agent cache-read share was 89–94% in every compat arm.** That matches native (90–93%). With reasoning on and the
  queue never caught up, the compact view is rewritten rarely. The 76–84% seen with reasoning off may come back once
  summaries complete quickly; that was not measured here.

## Recommendation

**Keep reuse (always on) and the rule gate (on by default).** Together they halve the summary work of tool-heavy
sessions: 48–63% fewer calls than the old engine. Both are deterministic, cost nothing to run, and keep every raw event
searchable. No probe loss was found in 216 offline probe-value checks or in 18 completed end-to-end runs.

**Jev:**

- **Agreement:** it agrees with the rules on everything they already decide.
- **Gain:** only 0–3 points of total calls on what remains.
- **Cost:** a second vendor and key, plus 250–400 ms per undecided leaf.
- **Risk:** on its own it drops big user messages.

Keep it opt-in (`summaryGateJev`, rules on), and do not recommend it.

**Long-term overhead vs native** cannot be settled from these reasoning-on runs. Their summaries cost 5–17× more per
node than today's reasoning-off default, which makes compat look 4–17× native here. Applying the reasoning-off price per node
($0.0004) to the replayed call counts suggests compat + reuse + rules lands near 1.6× native on logs and 2.3× on
support. That is an estimate, not a measurement.

**Next step** (approved, then deferred by the user): one reasoning-off matrix with native, compat, compat + rules, and
`injectRefreshBytes` 16 KiB, to confirm the overhead and the cache-read share.

## Reproduce

```sh
# Offline (Jev optional; verdicts cached by content hash, key only in the environment)
node plugins/@dshfiles/optmem/bench/gate-eval.mjs --runs <dir>/logs-B-r1,<dir>/support-B-r1 --out eval.json \
  [--jev --cache jev-cache.json]   # JEV_API_KEY_OPTMEM in env
# End-to-end arm (rules | jev | rules+jev | off)
BENCH_SUMMARY_GATE=rules node plugins/@dshfiles/optmem/bench/run-matrix.mjs --out <dir> --arms B \
  --scenarios logs,support --reps 2 --parallel 1 --drain-ms 600000
```

Raw evidence (answers, memory databases) stayed in scratch and was not published.
