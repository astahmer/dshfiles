# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output tokens and a 5 % safety margin, and converts the remaining tokens to serialized UTF-8 bytes with a deliberately conservative bytes-per-token ratio: the whole request, including the session's own system prompt and tool catalog, has to fit. A route that declares no window falls back to a conservative default, and a fixed prefix that does not fit that fallback is refused rather than sent oversized (plus provider-declared visual-token prices for images). A provider-confirmed context overflow first retries the same request with older tool outputs shortened, then older exchange text, oldest first, until it is about 60 % of the rejected size; the newest transaction stays intact and each shortened block keeps its first 1,024 and last 512 characters around an `[… N characters omitted to fit the compaction request …]` marker. Only if that retry overflows too is the chunk split into balanced halves. One tool transaction larger than the whole request budget is shortened the same way instead of failing the compaction. If the system prompt/tools, or a transaction with nothing long enough to shorten, cannot fit, the backend fails before writing a checkpoint rather than guessing or discarding history. When a route declares no image pricing, summary requests replace images with short named placeholders before sizing; the live history remains unchanged. Routes with declared image pricing keep their original behavior. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass overrides the published `summarize()` hook (calling `super.summarize()` for each bounded slice) and the dynamically dispatched `compactIfNeeded()` for the pressure trigger, and commits every checkpoint through the native `compactRegion()` transaction. Two stock helpers it needs are not exported, so `surface-range.ts` restates them: range selection (`selectCompactableRange`) and the replayed summary input (`buildSummarizationInput`). It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signatures, those two restated helpers, the native transaction behavior, and the engine integration tests before widening the peer range. No DSH core package or private source file is patched.

## Context-overflow recognition

The stock engine recovers from a model request only when the adapter coded its failure `CONTEXT_WINDOW_EXCEEDED`. Providers word that failure in many ways the core classifier misses (Anthropic's `prompt is too long`, Gemini's `input token count … exceeds the maximum number of tokens`, Bedrock, llama.cpp, xAI, Moonshot, Copilot, GLM, Cohere; the list is in `src/context-overflow.ts`). This engine recognizes those along the whole `cause` chain and nested provider error bodies, and gives them the same recovery: one overflow compaction, then a retry, at most `maxOverflowRetries` times per turn. An HTTP 413 counts only when its text mentions tokens or context; a per-minute token rate limit never counts. The same classifier decides when a summary request itself overflowed.

## A failure that a retry cannot fix

Some summary failures repeat on every attempt for the same history and request prefix: the system prompt and tool catalog alone exceed the summary budget, or one transaction cannot be shortened to fit. The automatic pressure trigger runs before every step, so such a failure used to repeat at every step of a long thread (one thread logged 289 failed attempts against 102 checkpoints). After one of these failures the engine skips pressure compaction for that thread until its history is rewritten (any compaction, manual or overflow) or its route or tool catalog changes. The provider-overflow recovery and `/compact` are not affected. A failed model request or an unreadable model capacity is not treated as permanent and is retried at the next step as before.

## Next compaction

The `threshold` API (agent tool `compaction_threshold`, module `@dshfiles/context-compaction/compaction-api`) answers, for one live thread, the token count at which automatic compaction next runs. It takes the running engine's resolved policy (captured from the engine instance, so profile overrides and `modelPolicies` count), the thread's routed provider/model from its latest request header, the route's context window, and the output reservation (`maxTokens` from that header, else the adapter default), and applies `floor(min(W × thresholdRatio, W − O − headroomTokens))` as `compaction-basic`'s `resolveCompactSpec` does (that function is not exported, so `compactionThresholdTokens` restates it and its tests pin the documented defaults). It also returns the engine's own pressure reading (`tokenMeter.measure().totalTokens`). It returns null before the thread routed a request, for a route that declares no window, and where the engine itself would skip proactive compaction.

One deliberate difference from the stock engine: a `headroomTokens` buffer that leaves the model no pressure budget (the default 65,536 on a window up to 73,728 tokens with an 8,192-token output reservation) is ignored instead of disabling proactive compaction on that route. The stock engine logs a warning and never compacts such a route ahead of an overflow; this one compacts at `floor(min(W × thresholdRatio, W − O))`. That pressure path skips the stock tool-result pruning. `@dshfiles/agent-plan` shows it beside the composer's context meter.

## Background summaries

Automatic compaction normally blocks the turn that crosses the threshold for as long as the summary request takes. With background summaries on, the engine starts that summary earlier, beside the conversation, and the automatic compaction commits it instantly. **Off by default**: a prepared summary the conversation moves past is a billed request whose result is thrown away.

At each step, once a thread's pressure reading reaches `startRatio` of its compaction threshold (and is still below it), the engine picks the span the next pressure compaction would replace (everything before the retained tail) and summarizes it in the background. Nothing waits for it: the turn, its tool calls and later steps run on, and it never writes to the Session. One summary per surface generation, so a failed or stale one is not retried until a compaction rewrites the history.

When the thread then crosses the threshold, the engine commits the prepared summary over its own span, through the native transaction, only if that span is still exactly what it summarized: same surface generation, same replayed messages and tools. Messages added since stay verbatim in the retained tail. Anything else (a manual `/compact`, a pruned tool result, an earlier compaction) means the conversation moved past it: the summary is dropped and the compaction runs as usual. If the prepared span alone does not bring the thread under the threshold, the usual compaction follows. A summary still in flight is awaited, which is never slower than starting one.

**Cost:** each background summary is a `compaction`-purpose model request on the thread's own Session id, so it counts toward that Session's tokens and cost in `@dshfiles/usage` (as a live call) whether it is applied or discarded. An applied one is also recorded in the Session log's `compaction/summary` event. A discarded one is pure overhead; a thread that stays between `startRatio` and the threshold until it ends pays for one summary it never uses. Each attempt records the `context compaction background summary` span with the Session id, whether it was due, and the replayed message count.

```yaml
config:
  backgroundSummary:
    enabled: true
    startRatio: 0.85
```

`startRatio` is a fraction of the threshold in (0, 1). Lower starts earlier, so the summary is more likely ready but covers a smaller span and is more likely to be followed by a second, blocking compaction. Requires automatic compaction (`auto`, on by default).

## Loaded skills

A compaction replaces the span it summarizes, and with it the bodies of the skills that span loaded, so a long thread loads the same skill again after each compaction (one thread loaded `dsh-sessions` 65 times). With `loadedSkills` on, each checkpoint appends a `<loaded-skills>` block after the summary: the skills that span loaded, read from the `skill` tool's results and from the block an earlier checkpoint kept, so the list survives every later compaction. **Off by default**: the block adds tokens to every later request.

| `loadedSkills` | Kept in each checkpoint                                                                                     |
| -------------- | ----------------------------------------------------------------------------------------------------------- |
| `off`          | Nothing (default).                                                                                          |
| `names`        | One line per skill: its name and directory, with a note that its instructions still apply.                  |
| `bodies`       | The names, plus each skill's instructions up to 32,000 characters per checkpoint; the rest keep their name. |

A skill quoted in conversation text does not count, only a tool result or a kept block. A skill result the tool-result pruner already shortened is kept as shortened.

```yaml
config:
  loadedSkills: names
```

## Idle compaction

A thread left idle past its provider's prompt-cache lifetime re-sends its whole prompt uncached on the next message. One compaction shortly before that costs less when the thread resumes much later, and nothing when it never resumes. **Off by default**: each compaction is one billed request per idle thread, so turn it on only after a measurement shows it pays (b:7csc).

The Host half sweeps every minute over the visible threads the Session controller lists. It only considers a thread whose last request or turn end this Host observed itself since it activated: session events arm a new idle stretch, and that timestamp is kept when the Agent is evicted, so a cold thread stays eligible from the request this Host saw. The thread list's `updatedAt` is deliberately not a fallback — it is the last human prompt, so a thread whose long turn ran after it would look idle far too early. A thread with no observed timestamp is skipped. After a Host restart the observation map is empty, so no cold thread is compacted until it shows new activity; the restart does not repeat a sweep over the same stale row.

A thread is due once its observed idle start is `lifetimeMinutes - leadMinutes` old (the fallback config is 5 and 1, so at 4 idle minutes), has no running turn, holds at least `idle.minTokens` (100,000 by default), and has not been attempted for this idle stretch. At `lifetimeMinutes` the cache is already gone, so the sweep stops and does not compact after expiry: a later compaction saves no re-send. It then calls `sessions.compact` with that token floor: the controller resumes a cold thread under its own admission, holds its Agent for the whole command, measures the thread, and skips it below the floor without a model request. Each pass records the `context compaction idle sweep` span with its candidate count.

Immediately before the billed request the sweep rechecks the live Agent: it must still be idle with an empty inbox, and the observed idle start must not have moved. A thread that started a turn or queued input since the pass began is left for the next sweep. One attempt per idle stretch means a provider failure is logged and not retried for that stretch; a new request arms a new one. The checkpoint message a compaction writes is not treated as activity, so a compaction cannot arm the next one.

Settings live on the Loader row config, next to `maxTokens`:

```yaml
config:
  idleCacheStrategy: compact
  idle:
    minTokens: 100000
    lifetimeMinutes: 60
    leadMinutes: 5
```

`idleCacheStrategy` is `off` (default) or `compact`; the older `idle.enabled: true` still selects `compact` when the strategy is unset. A compaction is one billed request per idle thread, so turn it on only after a measurement shows it pays.

Set `lifetimeMinutes` to the cache lifetime the route actually asks for: 5 for an Anthropic route on the default `short` retention, 60 with `cacheRetention: long` (ai-accounts › Idle prompt cache › Cache retention). `minTokens` is capped at 10,000,000, the Sessions API's own limit.

## Warm strategy is not available

OpenCode's `warm` alternative sends a minimal ping before the lifetime ends so the prefix stays cached. A plugin can replay the exact agent-loop request (same system, messages, tools, route and model) with `maxTokens: 1`, but that call cannot be counted in the Session's own cost total: `llm/stream` observers ignore requests carrying `toolHistory` (that is what marks an agent-loop call), and `appendPluginRecord` is restricted to `packages/experimental/`, so no plugin-owned usage record reaches the shared projection. Shipping warm without that accounting would spend tokens invisibly. The Host needs an auxiliary-request usage event (tracked in [Host gap 17](../../../plans/dsh-host-gaps.md#17-title-and-side-call-usage-in-history)) or a plugin-owned projection seam before `warm` can be exposed.

**Limits:** the sweep reads the newest 200 visible threads (`sessions.list`), so a very large history leaves older threads alone. A running thread is skipped. A thread this Host never observed active, including every thread at startup, is skipped until it emits a new request, turn end, or idle status. A failed command is logged and not retried for the same idle stretch, and a compaction is never attempted after the cache lifetime has expired.

## Engine setup comparison (2026-11-12, b:2ng6)

The web seed loads this engine as a root row and, through its restated `preset-standard`, the stock `compaction-basic` in the preset's isolated `compaction` group, so two automatic engines see every step. The owned engine's `agent/pre-step` hook runs first; the stock one acts only when the owned one failed or left the thread over its threshold. Only the stock group has a tool-result pruner: the root `tool-result-pruner` row is disabled, so this engine never prunes. Four setups were replayed:

| Setup | Profile composition                                                                               |
| ----- | ------------------------------------------------------------------------------------------------- |
| A     | Both engines automatic (the seed before this comparison)                                          |
| B     | Stock row loaded with `auto: false`; this engine is the only automatic one                        |
| C     | Stock row removed; root `tool-result-pruner` row on                                               |
| D     | A plus the root `tool-result-pruner` row on: this engine prunes, the stock row stays the fallback |

**Method.** `scripts/replay-workload.mjs` turns a recorded Session log into a shape-only workload: each user input, model step and tool result with its size, tool and skill names and image count, in recorded order, with no text. `tests/replay/harness.ts` replays it through the real agent loop (`AgentLoop`, `SessionStore`, `TokenMeter`, both engines and the pruner mounted as the profile composes them) and a scripted model: it answers each step with the recorded tool calls, each tool with a filler result of the recorded size, and each summary request with a 5,200-character summary (the median of six long threads' recorded checkpoints). Routes carry the recorded window and an output reservation that reproduces the recorded checkpoint sizes (gpt-6-luna: 272,000 / 32,000, so a 174,464-token threshold; gpt-6.1-sol: 128,000 / 16,384). Neither route declares image pricing, as on the live routes that logged `Cannot safely size an image-bearing summary` 14 times in ten days. A request over the window fails with `CONTEXT_WINDOW_EXCEEDED`. Each setup originally ran three times per scenario (A six times on the first two); B and C on images and skills-subagents originally ran once. After the fix, B and C ran three times each with `loadedSkills: off` and `names` on the three image-bearing scenarios, rotating order each repeat where possible; interrupted skills-subagents runs were completed separately. Counts and tokens were identical across repeats. The numbers compare setups, not absolute rates: filler text prices differently from real output, and the recorded small-context thread wrote 6 checkpoints where its replay under A writes 12.

| Scenario (recorded thread)                               | Shape                                                                           |
| -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| tool-heavy (`session-284fe9d9`, first 1,500 calls)       | 824 steps, 5.3 M result chars, 146 results over 8 KB, 63 skill loads, 365 tools |
| large-results (`session-850d8fc3`)                       | 771 calls, 116 results over 8 KB (max 49,933 chars), one pasted image           |
| images (`session-ab223c99`)                              | 1,326 calls, 50 images (screenshots read as tool results)                       |
| small-context (`session-b7f48396`, gpt-6.1-sol 128k)     | 236 calls, 47 tools, 20 skill loads                                             |
| skills-subagents (`session-1c924e97`, first 1,500 calls) | 139 skill loads of 23 skills, 7 subagent calls, 22 images                       |

Results (`loadedSkills: off`; median over repeats). B and C on the three image-bearing scenarios were rerun after the image-placeholder fix; A and D, and all other scenarios, are pre-fix baselines and are not a post-fix comparison. _Checkpoints_: succeeded / failed, with how many each engine wrote (ours / stock). _Uncached_: request tokens outside the prefix the previous request shared, the prompt-cache proxy. _Lost work_: overflow errors / turns that ended in error / recorded steps the replay dropped because no request of their turn fit. _Recent whole_: of the last 10 tool results before each checkpoint, the share still verbatim and unpruned in the next request.

| Scenario         | Setup | Checkpoints ok / failed (ours / stock) | Pruned | Peak tokens | Uncached tokens | Summary requests | Lost work | Recent whole | Engine ms per compaction |
| ---------------- | ----- | -------------------------------------- | ------ | ----------- | --------------- | ---------------- | --------- | ------------ | ------------------------ |
| tool-heavy       | A     | 21 / 0 (21 / 0)                        | 0      | 188k        | 2.64 M          | 21               | 0 / 0 / 0 | 100 %        | 12 (9–14) (n=6)          |
| tool-heavy       | B     | 21 / 0 (21 / 0)                        | 0      | 188k        | 2.64 M          | 21               | 0 / 0 / 0 | 100 %        | 14 (11–15) (n=3)         |
| tool-heavy       | C     | 14 / 0 (14 / 0)                        | 146    | 189k        | 3.13 M          | 14               | 0 / 0 / 0 | 88 %         | 18 (11–56) (n=3)         |
| tool-heavy       | D     | 14 / 0 (14 / 0)                        | 146    | 189k        | 3.13 M          | 14               | 0 / 0 / 0 | 88 %         | 11 (11–16) (n=3)         |
| large-results    | A     | 11 / 4 (10 / 1)                        | 13     | 178k        | 1.66 M          | 11               | 0 / 0 / 0 | 100 %        | 10 (8–53) (n=6)          |
| large-results    | B     | 11 / 0 (11 / 0)                        | 0      | 178k        | 1.59 M          | 11               | 0 / 0 / 0 | 100 %        | 11 (9–13) (n=3)          |
| large-results    | C     | 6 / 0 (6 / 0)                          | 115    | 188k        | 1.85 M          | 6                | 0 / 0 / 0 | 88 %         | 11 (9–16) (n=3)          |
| large-results    | D     | 6 / 1 (5 / 1)                          | 115    | 188k        | 1.85 M          | 6                | 0 / 0 / 0 | 88 %         | 9 (7–9) (n=3)            |
| images           | A     | 11 / 27 (1 / 10)                       | 97     | 195k        | 2.74 M          | 11               | 0 / 0 / 0 | 94 %         | 7 (7–9) (n=3)            |
| images           | B     | 14 / 0 (14 / 0)                        | 0      | 191k        | 2.05 M          | 14               | 0 / 0 / 0 | 100 %        | 14 (9–25) (n=3)          |
| images           | C     | 10 / 0 (10 / 0)                        | 105    | 199k        | 2.56 M          | 10               | 0 / 0 / 0 | 92 %         | 11 (11–13) (n=3)         |
| images           | D     | 10 / 9 (1 / 9)                         | 105    | 199k        | 2.56 M          | 10               | 0 / 0 / 0 | 92 %         | 9 (6–11) (n=3)           |
| small-context    | A     | 12 / 0 (12 / 0)                        | 0      | 55k         | 0.49 M          | 12               | 0 / 0 / 0 | 93 %         | 8 (5–8) (n=3)            |
| small-context    | B     | 12 / 0 (12 / 0)                        | 0      | 55k         | 0.49 M          | 12               | 0 / 0 / 0 | 93 %         | 5 (4–9) (n=3)            |
| small-context    | C     | 10 / 0 (10 / 0)                        | 22     | 55k         | 0.50 M          | 10               | 0 / 0 / 0 | 81 %         | 6 (4–7) (n=3)            |
| small-context    | D     | 10 / 0 (10 / 0)                        | 22     | 55k         | 0.50 M          | 10               | 0 / 0 / 0 | 81 %         | 6 (5–10) (n=3)           |
| skills-subagents | A     | 15 / 34 (7 / 8)                        | 184    | 192k        | 3.29 M          | 15               | 0 / 0 / 0 | 89 %         | 5 (4–5) (n=3)            |
| skills-subagents | B     | 23 / 0 (23 / 0)                        | 0      | 183k        | 3.15 M          | 23               | 0 / 0 / 0 | 100 %        | 8 (8–9) (n=3)            |
| skills-subagents | C     | 13 / 0 (13 / 0)                        | 242    | 192k        | 3.35 M          | 13               | 0 / 0 / 0 | 85 %         | 12 (9–13) (n=3)          |
| skills-subagents | D     | 13 / 8 (5 / 8)                         | 242    | 192k        | 3.35 M          | 13               | 0 / 0 / 0 | 85 %         | 9 (5–18) (n=3)           |

Before → after, B/C checkpoints succeeded / failed and recorded steps lost:

| Scenario         | Setup | Checkpoints        | Steps lost |
| ---------------- | ----- | ------------------ | ---------- |
| large-results    | B     | 5 / 338 → 11 / 0   | 158 → 0    |
| large-results    | C     | 2 / 335 → 6 / 0    | 154 → 0    |
| images           | B     | 0 / 2,013 → 14 / 0 | 968 → 0    |
| images           | C     | 0 / 1,904 → 10 / 0 | 918 → 0    |
| skills-subagents | B     | 2 / 1,655 → 23 / 0 | 779 → 0    |
| skills-subagents | C     | 1 / 1,519 → 13 / 0 | 712 → 0    |

The pre-fix B/C runs lost work, so their former token totals covered only the steps that still ran; those totals are not comparable with successful reruns.

What `loadedSkills` changes (same scenarios, _Skills kept_: loaded skills still named or present in the request right after each checkpoint):

| Scenario         | Setup | Skills kept, off → names | Checkpoints, off → names | Total request tokens, off → names |
| ---------------- | ----- | ------------------------ | ------------------------ | --------------------------------- |
| tool-heavy       | A     | 11 % → 100 %             | 21 → 21                  | 121.7 M → 121.8 M                 |
| tool-heavy       | B     | 11 % → 100 %             | 21 → 21                  | 121.7 M → 121.8 M                 |
| tool-heavy       | C     | 19 % → 100 %             | 14 → 14                  | 126.3 M → 126.4 M                 |
| large-results    | A     | 13 % → 62 %              | 11 → 11                  | 56.3 M → 56.3 M                   |
| large-results    | B     | 27 % → 100 %             | 11 → 11                  | 56.6 M → 56.5 M                   |
| large-results    | C     | 36 % → 100 %             | 6 → 6                    | 59.8 M → 59.9 M                   |
| images           | A     | 34 % → 37 %              | 11 → 11                  | 176.5 M → 176.5 M                 |
| images           | B     | 27 % → 100 %             | 14 → 14                  | 169.4 M → 169.5 M                 |
| images           | C     | 42 % → 100 %             | 10 → 10                  | 176.6 M → 177.0 M                 |
| small-context    | A     | 14 % → 100 %             | 12 → 13                  | 10.6 M → 10.6 M                   |
| small-context    | B     | 14 % → 100 %             | 12 → 13                  | 10.6 M → 10.6 M                   |
| small-context    | C     | 16 % → 100 %             | 10 → 10                  | 10.6 M → 10.8 M                   |
| skills-subagents | A     | 32 % → 53 %              | 15 → 15                  | 147.0 M → 147.5 M                 |
| skills-subagents | B     | 17 % → 100 %             | 23 → 23                  | 139.9 M → 140.1 M                 |
| skills-subagents | C     | 30 % → 100 %             | 13 → 13                  | 148.2 M → 148.4 M                 |

**Wall time.** The replay's engine time per compaction is 5–20 ms median in every setup (spread up to 56 ms under a load average of 60–100): the model call dominates. Live, a stock checkpoint took 42 s median (p10 28 s, p90 69 s, 121 checkpoints on gpt-6-luna); this engine's 14 recorded checkpoints took 109 s median, but on gpt-6.1-terra with larger spans, so not comparable. The number of summary requests is the model-time proxy: one per checkpoint in every run here (no span needed splitting).

**Live baseline (ten days to 2026-11-12, all threads):** 135 automatic checkpoints, 121 written by the stock row and 14 by this engine; this engine failed 319 times on the summary budget (fixed 2026-11-08 in `jj:qksquuvpmqku`) and 14 times on image pricing. So far the stock row has been doing the work this engine refused.

**Verdict: reassess the setup; the prior A winner predates the fix.** B and C no longer fail on unpriced images in the rerun. C trades fewer summary requests for pruned recent results and cache misses; B retains recent results but makes more summary requests. The historical A and D rows still include stock fallback and were not rerun, so they do not establish a post-fix winner. A priced run on real models and a full post-fix comparison would settle the tradeoff. No profile change follows from this replay.

**Reproduce:**

```bash
COMPACTION_REPLAY=/tmp/replay.json pnpm exec vitest run tests/compaction-replay.spec.ts -t matrix   # 3 repeats; COMPACTION_REPLAY_SCENARIOS / _SETUPS / _REPEATS narrow it
node scripts/replay-report.mjs /tmp/replay.json
```

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
