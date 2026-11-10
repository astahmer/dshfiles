# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output tokens and a 5 % safety margin, and converts the remaining tokens to serialized UTF-8 bytes with a deliberately conservative bytes-per-token ratio: the whole request, including the session's own system prompt and tool catalog, has to fit. A route that declares no window falls back to a conservative default, and a fixed prefix that does not fit that fallback is refused rather than sent oversized (plus provider-declared visual-token prices for images). A provider-confirmed context overflow recursively splits a multi-message chunk. If the system prompt/tools or one indivisible transaction cannot fit, or an image route has no declared visual-token price, the backend fails before writing a checkpoint rather than guessing or discarding history. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass uses only the published `BasicCompactionEngine` hook and calls `super.summarize()` for each bounded slice. It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signature, the native transaction behavior, and the chunking tests before widening the peer range. No DSH core package or private source file is patched.

## Next compaction

The `threshold` API (agent tool `compaction_threshold`, module `@dshfiles/context-compaction/compaction-api`) answers, for one live thread, the token count at which automatic compaction next runs. It takes the running engine's resolved policy (captured from the engine instance, so profile overrides and `modelPolicies` count), the thread's routed provider/model from its latest request header, the route's context window, and the output reservation (`maxTokens` from that header, else the adapter default), and applies `floor(min(W × thresholdRatio, W − O − headroomTokens))` as `compaction-basic`'s `resolveCompactSpec` does (that function is not exported, so `compactionThresholdTokens` restates it and its tests pin the documented defaults). It also returns the engine's own pressure reading (`tokenMeter.measure().totalTokens`). It returns null before the thread routed a request, for a route that declares no window, and where the engine itself would skip proactive compaction. `@dshfiles/agent-plan` shows it beside the composer's context meter.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
