# OptMem: what we learned (2026-10-13 → 14)

A summary of every OptMem experiment run on stock DSH 0.2.0-rc.2: the context, the key numbers, and the conclusion they
led to. The detailed reports are linked; this page is the one to read first.

All runs used AI Accounts route `opencode-go-alex` → DeepSeek V4.1 Flash, with list prices of $0.15 / M input,
$0.003 / M cached input and $0.60 / M output. Costs are list-price estimates; on a subscription, read them as quota.

## The question

OptMem summarizes a thread's history continuously into a tree of memory nodes and gives the agent a compact view of it.
**Compat** mode re-emits that view into DSH's own context; **full** mode replaces the context with it on every request
(through `@dshfiles/request-messages`). Is either worth its cost compared with native DSH compaction?

## What each experiment showed

| experiment                                                                                       | key numbers                                                                                                                                                                                                                                        | conclusion                                                                                                                      |
| ------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| [Context modes](benchmark-2026-10-13.md), 18 runs                                                | cross-session recall 8/8 with OptMem vs 0/8 native; same-session recall 40/40 and coding acceptance 18/18 in every arm; compat ≈ 2.5× native list cost; summaries are most of the extra                                                            | The only gain is recall **across** threads. Inside one thread, the 1M context plus native compaction ties.                      |
| Long real-window pilots (luna monitoring thread)                                                 | 59–71% of summary calls hit the output cap and used 83–90% of summary output; raising the cap to 8,192 cost ~3× and still lost 3 owners' names; a 24-turn handoff failed the same check (action order) in both OptMem arms                         | The summarizer wasted most of its budget; the handoff failure is a model/prompt issue, not OptMem.                              |
| [Summary reasoning off](benchmark-2026-10-13-summary-reasoning.md), 68-turn runs                 | reasoning off: 0/3,577 capped calls (54% before), summaries 5–17× cheaper per node, backlog drains in 3/4 runs (0/4 before); recall 9/12 cross-session (native 0/12); acceptance 30/32 (native 26/32); total 1.8–3.2× native                       | Hidden reasoning was the waste. Now the default for OpenCode Go. Unreasoned summaries overshoot the byte budget (≈55% clipped). |
| [Jev / rules / reuse gate](benchmark-2026-10-14-jev-gate.md), 18 e2e runs + offline replay of 12 | exact-input reuse −40–44% summary calls; + rules −55–60%; + Jev −57–62%; 0/108 probe values lost; Jev ≈ 240 ms p50 and < $0.002 per run; estimated compat with reasoning off + reuse + rules ≈ 1.6× native (logs) and 2.3× (support), not measured | Half of the merges were identical requests. Jev agrees with the rules and adds almost nothing; don't adopt it.                  |
| Codex gpt-6-luna as summarizer                                                                   | about as cheap as DeepSeek with reasoning off, dropped surnames in 1/3 runs, spends ChatGPT-plan quota                                                                                                                                             | Not adopted.                                                                                                                    |

## Where the cost comes from

At its best, compat still costs about **1.6–2.3× native** per thread. Two causes, both by design:

1. **Continuous summarization.** Every event is summarized and merged as it arrives, mostly for nodes nobody reads.
2. **Rewriting the live context.** Each re-emitted view breaks the provider's prefix cache. The agent's cache-read share
   fell from 93–98% (native) to 76–84% once summaries completed. On DeepSeek a cached input token costs 50× less, so
   that alone roughly triples the agent's input cost, and the effect grows with the price of the main model.

Full mode sends the smallest prompts but rebuilds the context every request, so it has the same cache problem.

## Conclusion

- **OptMem's live modes are not worth 1.6–3× per thread for occasional cross-thread recall.**
- What is worth keeping is the recall itself, at near-zero cost. That is the job of the new `@dshfiles/memory` plugin:
  - DSH's own session logs are the store;
  - one digest per finished thread;
  - a small, stable start-of-thread block that the prefix cache keeps;
  - search and read tools, plus agent-written notes;
  - nothing injected mid-thread.
- **Measured (2026-10-14):** memory cost **1.18× native** per run (its digests 0.3–5% of native; the rest is agent-loop
  variance) and recalled **11/12** cross-session probes. Compat cost **at least 2.54×** for **10/12**; native 0/12.
  Memory replaced OptMem in the `web` profile; OptMem's compat and full modes are retired from it, the code stays.
  Details: [memory findings](../../memory/docs/findings.md).

## What carries over

- Summaries and digests: a cheap model with **reasoning off** (DeepSeek V4.1 Flash on OpenCode Go). Never reasoning-on.
- Reuse identical requests before calling a model.
- Prefer deterministic extraction (jj descriptions, final messages, todos) over model summaries.
- Anything injected into the context must sit in a stable prefix or be appended. Never rewrite the middle.
- The bench harness (`bench/`) and its cross-session probes are the regression test for any memory change.
