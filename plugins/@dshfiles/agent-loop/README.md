# @dshfiles/agent-loop

Owned fork of [`@deepseek-ai/dsh-agent-loop`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/core/agent-loop)
pinned at `dsh-v0.2.1-rc.2`. It replaces the `agent-loop` Loader row; the native row is disabled, DSH core stays untouched.
Provenance and the delta list are in [`native-fork.json`](./native-fork.json); drift is checked with
`node scripts/native-fork-diff.mjs agent-loop`.

## Why

A settled assistant message carries the provider's replay envelope **twice**: on the message source
(`message.source.replayState`) and inside the durable compact stream (`stream[].chunk`, the terminal `finish` record).
Only the source copy is read back for a provider replay, so the stream copy duplicated the per-block metadata for the
life of the Session.

Measured on `session-6b9ec57a` (760 assistant messages, 19 MB of events, 2026-11-09):

| Part of `assistant/message`                                    | Bytes   |
| -------------------------------------------------------------- | ------- |
| Whole event data                                               | 4.55 MB |
| `message.source.replayState.blocks`                            | 433 KB  |
| `stream[].chunk.replayState.blocks` (the copy this fork drops) | 433 KB  |
| `data.stream` in total                                         | 2.85 MB |

So the fork removes ~9.5 % of that Session's `assistant/message` bytes, and ~2.3 % of its whole event log. It is a
real duplicate removed, **not** the explanation for a multi-GB live heap.

`tests/agent-loop.integration.test.ts` drives the real loop with a scripted adapter and compares both sides of the
fork in one run (one 600-byte provider signature):

| Stored `assistant/message` data                     | Upstream | Fork    |
| --------------------------------------------------- | -------- | ------- |
| `message.source.replayState.blocks` in the event    | 1        | 1       |
| `stream[].chunk.replayState.blocks` in the event    | 1        | 0       |
| Serialized event bytes                              | 1,981 B  | 1,353 B |
| Blocks on the replayed assistant message, request 2 | 1        | 1       |

## Runaway tool calls

On 2026-11-11 a Codex `apply_patch` call streamed 199 KB of `\n ` over 15 minutes (49,830 argument chunks, about
13 B/s) until the provider dropped the connection; the whole step then failed with `TRANSPORT terminated`. The adapter
idle watchdog never fired, because chunks kept arriving.

The fork bounds one tool call's streamed arguments, counted from that call's first chunk:

| Setting (agent-loop row config) | Default            | Effect                                             |
| ------------------------------- | ------------------ | -------------------------------------------------- |
| `maxToolCallArgumentBytes`      | `524288` (512 KiB) | UTF-8 bytes one call's arguments may reach         |
| `toolCallArgumentTimeoutMs`     | `180000` (3 min)   | how long one call may keep streaming its arguments |

Past either bound the attempt stops and the provider request is aborted. The cut call is stored with `{}` arguments and
never runs; its error result (`TOOL_ARGUMENTS_LIMIT_EXCEEDED`) says what was measured and tells the model to resend
smaller calls (one `apply_patch` edit per call, or append in chunks). Other calls still open in the same reply are cut
too and told to resend on their own; calls that already finished run normally. The turn continues with the next step,
and the user's input is not sent again. A stream that goes silent is still the adapter's idle watchdog's job (300 s on
pi-ai routes). Set them on the `dshfiles-agent-loop` row; both are volatile and read at each model attempt.

## Output-token limit

A reply that stops on the output-token limit (`finish: max-tokens`) ends the turn upstream, even mid-sentence or
mid-tool-call. With `maxOutputLimitContinuations` above `0` the fork runs that many extra steps instead:

| Setting (agent-loop row config) | Default | Effect                                                                         |
| ------------------------------- | ------- | ------------------------------------------------------------------------------ |
| `maxOutputLimitContinuations`   | `0`     | extra steps per turn after a cut reply, `0`–`2`; `0` ends the turn as upstream |

Off by default because each continuation is one more model call nobody asked for. The cut reply stays in history once,
exactly as streamed: nothing is re-streamed or rewritten. The extra step's only new input is a short `user/message` with
source `output-limit-continuation` (the chat shows it as a notice) that asks the model to continue where it stopped
without repeating itself, quotes the last 200 characters, and names any tool call the limit cut. The native assembler
drops such calls, so nothing ran; the model is told to resend them smaller. Past the bound the turn ends with
`max-tokens`, as before. Volatile, read at each cut.

## Delta

| File                                              | Change                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/assistant-stream.ts`                  | adds `settledStream`: the same compact records, with the terminal chunk's envelope reduced to its `response` part                                                                                                                  |
| `src/native/agent.ts`                             | both `assistant/message` appends (settled and interrupted) store `live.settledStream`; `assistant/attempt` still uses the untouched `live.stream`                                                                                  |
| `src/native/index.ts`                             | Cordis declares `FiberState` as a `const enum`, and this workspace pins a Cordis whose runtime has no such export, so the three inactive states are inlined as numbers with the same meaning; the two tool-argument settings below |
| `src/native/agent.ts` (2)                         | the stream read feeds every chunk to `ToolArgumentLimit`; at a cut it closes the cut calls, leaves the loop (which aborts the provider request), runs only the complete calls and records an error result for each cut one         |
| `src/native/tool-argument-limit.ts` (added)       | the bounds, the cut, and the result text the model reads                                                                                                                                                                           |
| `src/native/agent.ts` (3), `index.ts`             | `maxOutputLimitContinuations`: on a `max-tokens` finish within the bound, queue the continuation note on `next-step` and return a non-final step instead of `max-tokens`                                                           |
| `src/native/output-limit-continuation.ts` (added) | watches the attempt for the text tail and cut tool calls, and builds the note                                                                                                                                                      |

`src/host.ts` is ours: it hosts the native plugin class unchanged, like the other vendor forks.

## Verification

```sh
pnpm --dir plugins/@dshfiles/agent-loop typecheck
pnpm --dir plugins/@dshfiles/agent-loop test        # settled-stream, tool-argument-limit, output-limit-continuation
node scripts/native-fork-diff.mjs agent-loop
```

The provider keeps its envelope because the fork never touches `message.source`. Recovery of an unterminated attempt
still reads the full stream: `assistant/attempt` events are unchanged.

## Update policy

Re-apply the deltas on an upstream bump, then re-run `native-fork-diff` and the test above. The `FiberState`
inlining can be deleted as soon as the workspace Cordis version exports it.
