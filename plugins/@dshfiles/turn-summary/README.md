# @dshfiles/turn-summary

One line under each finished turn that says what the agent did with tools:

> Ran 6 commands · edited 3 files · read 4 files · 2 searches · **1 failed ›**

The red failure count opens a list naming each failed command (its description, or the first line of the command) and how it ended: `exit 1`, `signal SIGKILL`, `no exit code`, or `error` when the tool rejected the call. Edits count distinct files that were actually written; a rejected edit is not counted.

Built with dshx (no port). Run `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.

## Settings (`dshfiles-turn-summary`)

All apply live.

| Key            | Default | Meaning                                                        |
| -------------- | ------- | -------------------------------------------------------------- |
| `enabled`      | `true`  | Show the summary line under finished turns.                    |
| `includeReads` | `true`  | Count file reads and searches as well as commands and edits.   |
| `listFailures` | `true`  | Let the failed-command count open the list of failed commands. |

## How it works

- **Data.** A state-only Conversation Definition, registered on `ctx.uiConversation.events`, follows each turn's `turn/start`, `tool/call`, `tool/result` and `turn/end` events and, when the turn ends, publishes a `TurnActivitySummary` on the turn under `dshfiles-turn-activity` (a `ConversationTurnDataMap` key). It owns no view target, so it never claims an event from a native Definition.
- **View.** A `conversation.chat.turnTail` list entry (the seat of the native "Edited files" chip) reads that value through `turn.data.source(...)`.
- **Arguments** are read with the Host's own `PartialArguments` from `@deepseek-ai/dsh-util-values`; dshx inlines that package into client bundles for this plugin.
- **Exit codes** come from the `[exit code: N]` / `[killed by signal: …]` footer the bash tool appends to its result.

## Limits

- The summary sits under the turn, not in each "Ran commands" group header: the Host draws that header with no plugin seam ([`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md)).
- A turn whose tool calls fell outside the loaded history summarises only the calls still loaded.
