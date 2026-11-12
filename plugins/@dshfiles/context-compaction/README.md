# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output tokens and a 5 % safety margin, and converts the remaining tokens to serialized UTF-8 bytes with a deliberately conservative bytes-per-token ratio: the whole request, including the session's own system prompt and tool catalog, has to fit. A route that declares no window falls back to a conservative default, and a fixed prefix that does not fit that fallback is refused rather than sent oversized (plus provider-declared visual-token prices for images). A provider-confirmed context overflow first retries the same request with older tool outputs shortened, then older exchange text, oldest first, until it is about 60 % of the rejected size; the newest transaction stays intact and each shortened block keeps its first 1,024 and last 512 characters around an `[… N characters omitted to fit the compaction request …]` marker. Only if that retry overflows too is the chunk split into balanced halves. One tool transaction larger than the whole request budget is shortened the same way instead of failing the compaction. If the system prompt/tools, or a transaction with nothing long enough to shorten, cannot fit, or an image route has no declared visual-token price, the backend fails before writing a checkpoint rather than guessing or discarding history. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass overrides the published `summarize()` hook (calling `super.summarize()` for each bounded slice) and the dynamically dispatched `compactIfNeeded()` for the pressure trigger, and commits every checkpoint through the native `compactRegion()` transaction. Two stock helpers it needs are not exported, so `surface-range.ts` restates them: range selection (`selectCompactableRange`) and the replayed summary input (`buildSummarizationInput`). It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signatures, those two restated helpers, the native transaction behavior, and the engine integration tests before widening the peer range. No DSH core package or private source file is patched.

## Context-overflow recognition

The stock engine recovers from a model request only when the adapter coded its failure `CONTEXT_WINDOW_EXCEEDED`. Providers word that failure in many ways the core classifier misses (Anthropic's `prompt is too long`, Gemini's `input token count … exceeds the maximum number of tokens`, Bedrock, llama.cpp, xAI, Moonshot, Copilot, GLM, Cohere; the list is in `src/context-overflow.ts`). This engine recognizes those along the whole `cause` chain and nested provider error bodies, and gives them the same recovery: one overflow compaction, then a retry, at most `maxOverflowRetries` times per turn. An HTTP 413 counts only when its text mentions tokens or context; a per-minute token rate limit never counts. The same classifier decides when a summary request itself overflowed.

## A failure that a retry cannot fix

Some summary failures repeat on every attempt for the same history and request prefix: the system prompt and tool catalog alone exceed the summary budget, one transaction cannot be shortened to fit, or an image route declares no image pricing. The automatic pressure trigger runs before every step, so such a failure used to repeat at every step of a long thread (one thread logged 289 failed attempts against 102 checkpoints). After one of these failures the engine skips pressure compaction for that thread until its history is rewritten (any compaction, manual or overflow) or its route or tool catalog changes. The provider-overflow recovery and `/compact` are not affected. A failed model request or an unreadable model capacity is not treated as permanent and is retried at the next step as before.

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

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
