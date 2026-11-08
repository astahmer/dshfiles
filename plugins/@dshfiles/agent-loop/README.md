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

## Delta

| File                             | Change                                                                                                                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/assistant-stream.ts` | adds `settledStream`: the same compact records, with the terminal chunk's envelope reduced to its `response` part                                                                            |
| `src/native/agent.ts`            | both `assistant/message` appends (settled and interrupted) store `live.settledStream`; `assistant/attempt` still uses the untouched `live.stream`                                            |
| `src/native/index.ts`            | Cordis declares `FiberState` as a `const enum`, and this workspace pins a Cordis whose runtime has no such export, so the three inactive states are inlined as numbers with the same meaning |

`src/host.ts` is ours: it hosts the native plugin class unchanged, like the other vendor forks.

## Verification

```sh
pnpm --dir plugins/@dshfiles/agent-loop typecheck
pnpm --dir plugins/@dshfiles/agent-loop test        # tests/settled-stream.test.ts
node scripts/native-fork-diff.mjs agent-loop
```

The provider keeps its envelope because the fork never touches `message.source`. Recovery of an unterminated attempt
still reads the full stream: `assistant/attempt` events are unchanged.

## Update policy

Re-apply the three deltas on an upstream bump, then re-run `native-fork-diff` and the test above. The `FiberState`
inlining can be deleted as soon as the workspace Cordis version exports it.
