# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output tokens and a 5 % safety margin, and converts the remaining tokens to serialized UTF-8 bytes with a deliberately conservative bytes-per-token ratio: the whole request, including the session's own system prompt and tool catalog, has to fit. A route that declares no window falls back to a conservative default, and a fixed prefix that does not fit that fallback is refused rather than sent oversized (plus provider-declared visual-token prices for images). A provider-confirmed context overflow recursively splits a multi-message chunk. If the system prompt/tools or one indivisible transaction cannot fit, or an image route has no declared visual-token price, the backend fails before writing a checkpoint rather than guessing or discarding history. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass uses only the published `BasicCompactionEngine` hook and calls `super.summarize()` for each bounded slice. It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signature, the native transaction behavior, and the chunking tests before widening the peer range. No DSH core package or private source file is patched.

## Next compaction

The `threshold` API (agent tool `compaction_threshold`, module `@dshfiles/context-compaction/compaction-api`) answers, for one live thread, the token count at which automatic compaction next runs. It takes the running engine's resolved policy (captured from the engine instance, so profile overrides and `modelPolicies` count), the thread's routed provider/model from its latest request header, the route's context window, and the output reservation (`maxTokens` from that header, else the adapter default), and applies `floor(min(W × thresholdRatio, W − O − headroomTokens))` as `compaction-basic`'s `resolveCompactSpec` does (that function is not exported, so `compactionThresholdTokens` restates it and its tests pin the documented defaults). It also returns the engine's own pressure reading (`tokenMeter.measure().totalTokens`). It returns null before the thread routed a request, for a route that declares no window, and where the engine itself would skip proactive compaction. `@dshfiles/agent-plan` shows it beside the composer's context meter.

## Idle compaction

A thread left idle past its provider's prompt-cache lifetime re-sends its whole prompt uncached on the next message. One compaction shortly before that costs less when the thread resumes much later, and nothing when it never resumes. **Off by default**: each compaction is one billed request per idle thread, so turn it on only after a measurement shows it pays (b:7csc).

The Host half sweeps every minute over the visible threads the Session controller lists. A thread is due when it is idle, has no running turn, holds at least `idle.minTokens` (100,000 by default), and its last request is `lifetimeMinutes - leadMinutes` old (60 and 5 by default, so at 55 idle minutes). It then calls `sessions.compact` with that token floor: the controller resumes a cold thread under its own admission, holds its Agent for the whole command, measures the thread, and skips it below the floor without a model request. Each pass records the `context compaction idle sweep` span with its candidate count. One compaction per idle stretch: a later request re-arms it.

Settings live on the Loader row config, next to `maxTokens`:

```yaml
config:
  idle:
    enabled: true
    minTokens: 100000
    lifetimeMinutes: 60
    leadMinutes: 5
```

Set `lifetimeMinutes` to the cache lifetime the route actually asks for: 5 for an Anthropic route on the default `short` retention, 60 with `cacheRetention: long` (ai-accounts › Idle prompt cache › Cache retention).

**Limits:** the sweep reads the newest 200 visible threads (`sessions.list`), so a very large history leaves older threads alone. Its idle start is the thread list's `updatedAt` for a cold thread (the last human prompt) and the last request or turn end for a resident one, so a thread whose long turn just finished may look idle slightly early. A running thread is skipped; a failed command is logged and retried on a later sweep.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
