# @dshfiles/context-compaction

Replaces DSH's stock `compaction-basic` Loader row with an owned subclass that preserves its pressure policy, range selection, tool-result pruning, and durable checkpoint transaction while bounding every summarization request.

The stock summarizer replays the entire selected history in one auxiliary request. When that selected region is itself larger than the model window, the summary request fails with `CONTEXT_WINDOW_EXCEEDED`; no durable checkpoint is written, so the next attempt sees the same oversized surface. This replacement splits the selected history into bounded, contiguous requests, keeps tool-call/result transactions together, then folds their checkpoint summaries into one final summary before returning to the native transaction.

The request budget comes from the resolved model context window, reserves output and fixed prompt headroom, and uses serialized UTF-8 bytes as a conservative text-size proxy (plus provider-declared visual-token prices for images). A provider-confirmed context overflow recursively splits a multi-message chunk. If the system prompt/tools or one indivisible transaction cannot fit, or an image route has no declared visual-token price, the backend fails before writing a checkpoint rather than guessing or discarding history. Multiple auxiliary calls are not falsely recorded as one provider output; DSH still traces each `llm.stream()` call.

The subclass uses only the published `BasicCompactionEngine` hook and calls `super.summarize()` for each bounded slice. It depends on `@deepseek-ai/dsh-compaction-basic@0.2.1-rc.2`; this is an extension, not copied upstream code. On each DSH upgrade, re-check the hook signature, the native transaction behavior, and the chunking tests before widening the peer range. No DSH core package or private source file is patched.

## Verify

```bash
pnpm typecheck
pnpm test
pnpm build
```

The web profile patch disables the stock row and inserts `@dshfiles/context-compaction` with an 8,192-token summary output cap. The profile seed change takes effect after the user restarts the DSH Host; it does not restart the live `web` process.
