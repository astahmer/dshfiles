# OptMem context modes on a real model — benchmark 2026-10-13

Three arms on stock DSH, one real model, three scripted scenarios, two repetitions each (18 runs, no errors):

- **A — native compaction only.** OptMem is not loaded. DSH's `compaction-basic` summarizes old history under pressure.
- **B — OptMem compatibility.** OptMem captures, summarizes and injects its compact view; DSH keeps and compacts its own
  history as in A.
- **C — OptMem full.** `@dshfiles/request-messages` is loaded; each agent request carries system + instructions + one
  memory view + the current turn, and DSH pressure compaction is deferred.

Harness, scenarios and fixtures: [`bench/`](../bench/). Per-run numbers (no transcripts):
[`bench/results/2026-10-13/summary.json`](../bench/results/2026-10-13/summary.json).

## Setup

| item              | value                                                                                                                                                                |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| runtime           | DSH 0.2.0-rc.2 as installed (no fork), Node 22.23.3, darwin/arm64; profile = `dsh-base`, `dsh-web-app`, `shared-runtime`, `ai-accounts`, bench probe (+ arm bundles) |
| model             | AI Accounts route `opencode-go-alex` → `deepseek-v4.1-flash`, adapter-default effort; the adapter reports a 1,000,000-token context window                           |
| OptMem summarizer | default routing (`cheapModels` → the same `deepseek-v4.1-flash` on the same account), default budgets (512 B nodes, 8 KB compact view)                               |
| compaction policy | same in every arm: `thresholdRatio 0.032` (32,000 tokens), `retainTokens 6400` — the default 0.8 / 0.16 policy scaled to a 40k window (see caveats)                  |
| isolation         | fresh scratch `DSH_HOME` per run (empty memory), ports 3221–3223, three runs in parallel; the live Host on 3080 and `~/.dsh` were not touched                        |
| measurement       | a benchmark-only bundle on `llm/stream` (+ `agent/request-messages` in C) logs every model call: purpose, messages and bytes built/sent, provider usage, latency     |
| price (estimate)  | models.dev list price for `opencode-go/deepseek-v4.1-flash` via AI Accounts' cache: $0.15 / M input, $0.003 / M cached input, $0.60 / M output                       |

Scenarios (all prompts, probes and expected answers are in `bench/scenarios/*.json`; ground truth for generated data comes
from `bench/fixtures.mjs`):

| scenario | turns  | what it exercises                                                                                                                                                                                                                                                                                  | quality signal                                                                                         |
| -------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| coding   | 22     | a small zero-dependency invoicing repo (`ledgerline`): read, run tests, fix a rounding and a CSV-quoting bug, add LU/AT VAT, discount codes per a pasted spec, validation, `summary()`, changelog, version bump; team conventions (`LL_` error codes) are given at turn 2 and needed at turns 6–15 | 9 hidden acceptance tests run after the conversation (incl. the project's own suite) + 4 recall probes |
| support  | 28 + 2 | a Halyard message-queue support thread: facts in turns 1–3, five pasted documents (release notes, config dump, email, runbook, lag CSV) with buried details, drafting work                                                                                                                         | 10 recall + 2 analysis probes, 2 probes in a new session                                               |
| logs     | 24 + 1 | incident analysis over 880 KB of generated gateway/worker/MySQL-slow logs with tool calls and large tool outputs                                                                                                                                                                                   | 8 analysis probes (exact counts/ids) + 6 recall probes, 1 probe in a new session                       |

Recall probes say "do not open files or run shell commands; memory tools are fine if you have them" and are scored by
case-insensitive substring match against the expected values (re-scored from stored answers by `report.mjs`).

## Results

Means of 2 runs; ranges in `bench/results/2026-10-13/summary.json`. "Prompt" = input + cached input as reported by the
provider. "Last turn" = prompt of the last agent request of the last main-session turn.

### Cost and context

| scenario | arm | prompt tok, all calls | cached | output tok | est. $ | last-turn prompt | max prompt / request | max msgs sent | native compactions | OptMem summary calls | wall s |
| -------- | --- | --------------------: | -----: | ---------: | -----: | ---------------: | -------------------: | ------------: | -----------------: | -------------------: | -----: |
| coding   | A   |             2,118,319 |  93.4% |     89,673 | 0.0806 |           26,361 |               31,952 |            72 |                  5 |                    0 |    749 |
| coding   | B   |             2,600,203 |  92.0% |    286,274 | 0.2104 |           31,289 |               31,927 |            70 |                  5 |                  136 |    865 |
| coding   | C   |             2,667,049 |  87.6% |    308,676 | 0.2416 |           32,984 |               49,935 |            41 |                  0 |                  177 |    986 |
| support  | A   |               656,884 |  92.9% |     22,064 | 0.0219 |           26,406 |               31,741 |            50 |                0.5 |                    0 |    242 |
| support  | B   |               651,242 |  90.5% |     65,367 | 0.0503 |           24,779 |               31,497 |            38 |                  1 |                   21 |    286 |
| support  | C   |               571,888 |  76.9% |     92,116 | 0.0764 |           14,575 |               17,224 |            13 |                  0 |                   31 |    462 |
| logs     | A   |             1,672,796 |  90.5% |     85,859 | 0.0798 |           28,527 |               31,739 |            57 |                  5 |                    0 |    721 |
| logs     | B   |             1,660,015 |  88.3% |    265,985 | 0.1935 |           29,075 |               31,772 |            55 |                  5 |                  123 |    654 |
| logs     | C   |             1,357,052 |  80.7% |    217,645 | 0.1732 |           19,746 |               42,723 |            18 |                  0 |                  119 |    634 |

Where the money goes (est. $, mean per run):

| scenario | arm | agent loop | native compaction | OptMem summaries | memory tool calls | mean time to first token |
| -------- | --- | ---------: | ----------------: | ---------------: | ----------------: | -----------------------: |
| coding   | A   |     0.0693 |            0.0113 |                — |                 0 |                    1.7 s |
| coding   | B   |     0.0711 |            0.0105 |           0.1288 |                 0 |                    1.8 s |
| coding   | C   |     0.0955 |                 — |           0.1461 |                39 |                    2.9 s |
| support  | A   |     0.0208 |            0.0009 |                — |                 0 |                    1.7 s |
| support  | B   |     0.0235 |            0.0022 |           0.0245 |                 0 |                    1.5 s |
| support  | C   |     0.0359 |                 — |           0.0404 |                21 |                    4.9 s |
| logs     | A   |     0.0665 |            0.0132 |                — |                 0 |                    1.4 s |
| logs     | B   |     0.0618 |            0.0126 |           0.1190 |               3.5 |                    1.6 s |
| logs     | C   |     0.0677 |                 — |           0.1054 |               8.5 |                    3.5 s |

Prompt per request at the end of selected turns (support, the chat-shaped scenario):

| arm | t1    | t5    | t10    | t15    | t20    | t25    | last   |
| --- | ----- | ----- | ------ | ------ | ------ | ------ | ------ |
| A   | 6,815 | 9,017 | 17,652 | 29,049 | 25,612 | 26,077 | 26,406 |
| B   | 7,478 | 9,599 | 19,082 | 24,806 | 24,141 | 24,571 | 24,779 |
| C   | 7,579 | 9,493 | 15,307 | 14,347 | 14,260 | 15,544 | 14,575 |

### Quality

| arm | recall probes, same session                                           | analysis probes | coding acceptance tests | recall in a new session |
| --- | --------------------------------------------------------------------- | --------------- | ----------------------- | ----------------------- |
| A   | 40/40                                                                 | 20/20           | 18/18                   | 0/8                     |
| B   | 39/40 (coding r2 omitted `src/discounts.js` from "files you changed") | 20/20           | 18/18                   | 8/8                     |
| C   | 40/40                                                                 | 20/20           | 18/18                   | 8/8                     |

Every coding run ended with the project's own suite green and all hidden acceptance checks passing, including the ones
that depend on conventions given 10+ turns earlier (`LL_UNKNOWN_REGION`, `LL_UNKNOWN_DISCOUNT`, `LL_INVALID_LINE`) after
4–6 native compactions in A and B.

### OptMem summarizer health

Of 1,212 OptMem summary calls across B and C, **436 (36%) ended at the 2,048-token output cap** (`finish: max-tokens`).
The engine then stores a clipped or unsummarized node: per run, 10–28 `clipped:` and 10–23 `unsummarized` nodes beside 60–122 good summaries (coding and logs), and in support 4–16 unsummarized of ~30 attempted (the pasted documents). The
provider reported no separate reasoning tokens, so the cap is hit by the model's own output on this route. This is the largest single cost item in B and C (49–61% of their estimated spend) and also degrades the memory those modes rely on.

## Reading

1. **Same-session quality is a tie.** With this model and 1–6 native compactions per session, DSH's compaction summaries
   kept every probed fact (ids, numbers, conventions, a value buried in a 5 KB config dump). OptMem did not improve
   same-session recall or task success here; the probes were not hard enough to separate the arms, which is itself the
   finding for sessions of this length.
2. **Cross-session recall is what OptMem buys.** A new session in the same project answered 8/8 with OptMem (B and C,
   via the injected view and `memory_search`) and 0/8 without.
3. **Full mode bounds the request in chat-shaped sessions** — support's last request is 14.6k tokens vs 26.4k (A) and
   24.8k (B), ≤13 messages vs 50, no native compaction — and sends 13–19% fewer prompt tokens overall in support and
   logs. It does not bound tool-heavy turns: within a turn it carries every tool result, and with pressure compaction
   deferred a long coding turn reached 44–56k tokens (A and B stay at the 32k threshold). Coding sent 26% more prompt
   tokens than A.
4. **Full mode costs latency and cache.** Cache hit rate drops from 90–93% to 77–88% (the view changes the prefix), the request-messages waterfall (OptMem's summary barrier) adds 1.3–3.2 s to time-to-first-token on every request, the model makes 8–39 extra memory-tool calls
   per run, and wall time is +32% (coding) and +91% (support) over A (logs: −12%). Its agent-loop spend alone is 2–73% higher than A.
5. **At list price, OptMem's cost is its summarizer.** Agent-loop spend of B is within ±13% of A; total spend is 2.3–2.6×
   (B) and 2.2–3.5× (C) of A, almost all of it summary output, a third of which is wasted on capped calls.

## Recommendation

- **Default: compatibility mode (B)** when cross-session memory is wanted. It leaves DSH's own context, cache behaviour
  and same-session quality as they are (measured equal to A) and adds recall across sessions. Plain native compaction (A)
  remains the cheapest choice when nothing needs to survive the session.
- **Full mode (C) stays opt-in.** Use it for long chat- and document-shaped sessions on small-window models, where the
  bounded request matters more than latency. It is not a better default on this route: no quality gain within a
  session, slower turns, lower cache reuse, and unbounded tool-heavy turns while compaction is deferred.
- **Fix the summarizer budget before anything else.** 36% capped summary calls make OptMem pay for output it throws
  away. Worth trying next: a non-reasoning or lower-effort summary route on this provider (`summarizerEffort`/`cheapModels`
  effort), or a larger output budget with the 512 B node limit unchanged; then re-run this benchmark. For full mode,
  letting pressure compaction (or tool-result pruning) act on the current turn's tool results would close the coding gap.

## Caveats

- **Emulated window.** The route reports a 1M-token window, where DSH never compacts sessions of this size. An earlier
  pilot run without the scaled policy (coding, arm A) grew to 89k-token requests with zero compactions, 99% cache hits,
  and the same acceptance result; at this provider's cache price that was the cheapest configuration of all ($0.057).
  The 32k policy stands in for a 40k-window model; results for real small-window models may differ.
- One model, one provider, adapter-default effort, and the summarizer on the same model. Two repetitions per cell, so
  ranges are reported, not confidence intervals; runs shared the provider three at a time.
- Scripted user turns and synthetic data (a hand-written repo, generated logs and documents). Probes are substring
  matches; one ambiguous probe (`early-bugs`) accepts either fix the session made before features.
- Costs are list-price estimates. The OpenCode Go account is a subscription with usage limits, so token volume is the
  operative quantity; the cached/uncached split comes from provider usage.
- Each run starts with empty memory, so cross-session probes only reach the run's own first session.

## Reproduce

```bash
pnpm --dir tooling/dshx --filter @dshfiles/dshx... build
for p in shared-runtime optmem-core optmem-sqlite request-messages ai-accounts optmem; do pnpm --dir plugins/@dshfiles/$p run build; done
cd plugins/@dshfiles/optmem/bench
node run-matrix.mjs --out /private/tmp/claude-501/optmem-bench-results/main --reps 2 --parallel 3 --base-port 3221
node report.mjs /private/tmp/claude-501/optmem-bench-results/main --json results/<date>/summary.json
```

`run-arm.mjs` copies only the selected AI Accounts entry and its one credential into each scratch home (mode 600) and
deletes the home when the run ends; `BENCH_PROVIDER`, `BENCH_MODEL` and `BENCH_EFFORT` pick another route.
