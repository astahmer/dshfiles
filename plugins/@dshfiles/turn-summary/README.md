# @dshfiles/turn-summary

![A summary line under each finished turn](docs/screenshots/turn-summary-line.png)

![A walkthrough opened under a turn that changed code](docs/screenshots/turn-walkthrough.png)

A footer under each finished turn that says what the agent did with tools:

> `pricing.ts +40 −3` `cart.ts +2 −4` · ran 6 commands › **2 of 42 tests failed ›** read 4 files · 2 searches · 1m 12s

- **Changed-file chips** (visual refresh T2.3) name each file the turn actually wrote (a rejected edit is not counted)
  with its lines added and removed; a chip opens that turn's review in the Changes facet (the file in the editor until
  the Host has addressed the turn's changes). Four chips show, the rest fold into `+N more`, which opens the
  walkthrough. With the walkthrough setting off, the footer falls back to the `Edited 3 files +42 −7 ›` count, whose
  list opens each file in the editor.
- **Commands** open every command (its description, or the first line of the command) with how it ended.
- **Tests** are the outcome of the last Vitest, Jest or pytest summary a command printed in the turn: "2 of 42 tests failed" in red, else "40 tests passed" in plain ink. Failed tests are the line's one red part: it opens every failed command, so no second failure count stands beside it. Without failed tests, failed commands get their own red part ("1 command failed").
- **Nothing twice, nothing empty.** Calls that are neither a command, an edit, a read nor a search get no part (no "1 other tool call"), a turn under a second shows no duration, and a turn with nothing to name gets no line. A wrapped line never starts with a separator, and no separator follows a chevron.
- The red **failure count** opens the failed commands and how each ended: `exit 1`, `signal SIGKILL`, `no exit code`, or `error` when the tool rejected the call.
- **Duration** is the turn's wall time, from `turn/start` to `turn/end`.

After a turn that edited files in several folders, or more files than the four chips show, a **Walkthrough** control
opens the changed files grouped by folder: each folder with its file count and, for several files, its line total. Every
file row opens that file in the editor, and **Review in Changes** opens that turn's changed-files review in the right
pane: diffs-review's Changes facet when it is loaded, else the native review tab. A turn that edited one file, or a few
files of one folder, gets no walkthrough: its chips already say all of it. The control sits in the turn footer, closed by
default, so nothing floats above the composer. While the `walkthrough` setting is on, the footer leaves out its **Edited
files** part: the chips already name the edits, so the count is shown once.

Built with dshx (no port). Run `pnpm build`, `pnpm test` and `pnpm typecheck` from this package.

## Settings (`dshfiles-turn-summary`)

All apply live.

| Key            | Default | Meaning                                                          |
| -------------- | ------- | ---------------------------------------------------------------- |
| `enabled`      | `true`  | Show the summary line under finished turns.                      |
| `includeReads` | `true`  | Count file reads and searches as well as commands and edits.     |
| `listFailures` | `true`  | Let the failed-command count open the list of failed commands.   |
| `lineCounts`   | `true`  | Show lines added and removed next to the edited-file count.      |
| `testResults`  | `true`  | Show the test outcome from the last test-runner summary.         |
| `duration`     | `true`  | Show how long the turn took.                                     |
| `openLists`    | `true`  | Let the edited-file and command counts open their lists.         |
| `walkthrough`  | `true`  | Name edited files as chips, with a walkthrough for larger turns. |

## How it works

- **Data.** A state-only Conversation Definition, registered on `ctx.uiConversation.events`, follows each turn's `turn/start`, `tool/call`, `tool/result` and `turn/end` events and, when the turn ends, publishes a `TurnActivitySummary` on the turn under `dshfiles-turn-activity` (a `ConversationTurnDataMap` key). It owns no view target, so it never claims an event from a native Definition.
- **Changes address.** The Definition also follows the turn's `workspace/changes` event (the Host's changed-files summary) and publishes its sequence, which addresses the native `dsh-resource://changes-review/session/<id>/<seq>/<turn>` review; the card opens it in the right pane of the thread on screen.
- **View.** A `conversation.chat.turnTail` list entry (the seat of the native "Edited files" chip) reads that value through `turn.data.source(...)`.
- **Arguments** are read with the Host's own `PartialArguments` from `@deepseek-ai/dsh-util-values`; dshx inlines that package into client bundles for this plugin.
- **Exit codes** come from the `[exit code: N]` / `[killed by signal: …]` footer the bash tool appends to its result.
- **Line counts** come from the edit calls' own arguments (`edit`, `str_replace_editor`, each `apply_patch` edit: old and new text with their shared leading and trailing lines dropped; `write`: its whole content as added).
- **Seat.** The plan named `conversation.chat.assistant-actions` for this footer, but that slot's owner props carry only the message id; `conversation.chat.turnTail` carries the turn, its data and `openFile`, so the footer stays there.

## Limits

- The summary sits under the turn, not in each "Ran commands" group header: the Host draws that header with no plugin seam ([`plans/dsh-host-gaps.md`](../../../plans/dsh-host-gaps.md)).
- A turn whose tool calls fell outside the loaded history summarises only the calls still loaded.
- A `write` that replaced an existing file counts all its lines as added: the call does not carry the old content.
