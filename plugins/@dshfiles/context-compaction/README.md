# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output tokens and a 5 % safety margin, and converts the remaining tokens to serialized UTF-8 bytes with a deliberately conservative bytes-per-token ratio: the whole request, including the session's own system prompt and tool catalog, has to fit. A route that declares no window falls back to a conservative default, and a fixed prefix that does not fit that fallback is refused rather than sent oversized (plus provider-declared visual-token prices for images). A provider-confirmed context overflow recursively splits a multi-message chunk. If the system prompt/tools or one indivisible transaction cannot fit, or an image route has no declared visual-token price, the backend fails before writing a checkpoint rather than guessing or discarding history. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass uses only the published `BasicCompactionEngine` hook and calls `super.summarize()` for each bounded slice. It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signature, the native transaction behavior, and the chunking tests before widening the peer range. No DSH core package or private source file is patched.

## Next compaction

The `threshold` API (agent tool `compaction_threshold`, module `@dshfiles/context-compaction/compaction-api`) answers, for one live thread, the token count at which automatic compaction next runs. It takes the running engine's resolved policy (captured from the engine instance, so profile overrides and `modelPolicies` count), the thread's routed provider/model from its latest request header, the route's context window, and the output reservation (`maxTokens` from that header, else the adapter default), and applies `floor(min(W × thresholdRatio, W − O − headroomTokens))` as `compaction-basic`'s `resolveCompactSpec` does (that function is not exported, so `compactionThresholdTokens` restates it and its tests pin the documented defaults). It also returns the engine's own pressure reading (`tokenMeter.measure().totalTokens`). It returns null before the thread routed a request, for a route that declares no window, and where the engine itself would skip proactive compaction. `@dshfiles/agent-plan` shows it beside the composer's context meter.

## Idle compaction

A thread left idle past its provider's prompt-cache lifetime re-sends its whole prompt uncached on the next message. One compaction shortly before that costs less when the thread resumes much later, and nothing when it never resumes. **Off by default**: each compaction is one billed request per idle thread, so turn it on only after a measurement shows it pays (b:7csc).

The Host half sweeps every minute over the visible threads the Session controller lists. It only considers a thread whose last request or turn end this Host observed itself since it activated: session events arm a new idle stretch, and that timestamp is kept when the Agent is evicted, so a cold thread stays eligible from the request this Host saw. The thread list's `updatedAt` is deliberately not a fallback — it is the last human prompt, so a thread whose long turn ran after it would look idle far too early. A thread with no observed timestamp is skipped. After a Host restart the observation map is empty, so no cold thread is compacted until it shows new activity; the restart does not repeat a sweep over the same stale row.

A thread is due once its observed idle start is `lifetimeMinutes - leadMinutes` old (the fallback config is 5 and 1, so at 4 idle minutes), has no running turn, holds at least `idle.minTokens` (100,000 by default), and has not been attempted for this idle stretch. At `lifetimeMinutes` the cache is already gone, so the sweep stops and does not compact after expiry: a later compaction saves no re-send. It then calls `sessions.compact` with that token floor: the controller resumes a cold thread under its own admission, holds its Agent for the whole command, measures the thread, and skips it below the floor without a model request. Each pass records the `context compaction idle sweep` span with its candidate count.

Immediately before the billed request the sweep rechecks the live Agent: it must still be idle with an empty inbox, and the observed idle start must not have moved. A thread that started a turn or queued input since the pass began is left for the next sweep. One attempt per idle stretch means a provider failure is logged and not retried for that stretch; a new request arms a new one. The checkpoint message a compaction writes is not treated as activity, so a compaction cannot arm the next one.

Settings live on the Loader row config, next to `maxTokens`:

```yaml
config:
  idle:
    enabled: true
    minTokens: 100000
    lifetimeMinutes: 60
    leadMinutes: 5
```

Set `lifetimeMinutes` to the cache lifetime the route actually asks for: 5 for an Anthropic route on the default `short` retention, 60 with `cacheRetention: long` (ai-accounts › Idle prompt cache › Cache retention). `minTokens` is capped at 10,000,000, the Sessions API's own limit.

**Limits:** the sweep reads the newest 200 visible threads (`sessions.list`), so a very large history leaves older threads alone. A running thread is skipped. A thread this Host never observed active, including every thread at startup, is skipped until it emits a new request, turn end, or idle status. A failed command is logged and not retried for the same idle stretch, and a compaction is never attempted after the cache lifetime has expired.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
