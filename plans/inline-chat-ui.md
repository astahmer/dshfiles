# Inline chat UI — make ongoing work readable

Goal: someone glancing at a thread can tell **what the agent is doing, what it changed, what it is waiting on, and
what failed**, without opening terminal dumps. Everything here renders inline in the transcript or in the strip
above the composer; nothing needs a new panel.

Sources surveyed 2026-10-19: [affectUI](https://www.affectui.com/components) (55 components, agent-focused),
[Vercel AI Elements](https://github.com/vercel/ai-elements), [prompt-kit](https://github.com/ibelick/prompt-kit),
[Agent Elements](https://github.com/21st-dev/agent-elements), [simple-ai](https://github.com/Alwurts/simple-ai),
[assistant-ui](https://github.com/assistant-ui/assistant-ui). [HextaUI](hextaui-blocks.md) is planned separately;
this plan absorbs its P1 rows (edit cards, code block, stack trace).

## Licences

| Source         | Licence                                             | Route                                                                                                     |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| AI Elements    | Apache-2.0                                          | **Port**: keep `LICENSE` + `NOTICE`, mark changed files                                                   |
| prompt-kit     | MIT                                                 | **Port**                                                                                                  |
| Agent Elements | MIT (small, last push 2026-04)                      | **Port** pieces; do not depend on it                                                                      |
| simple-ai      | MIT                                                 | **Port** pieces                                                                                           |
| assistant-ui   | MIT                                                 | Skip: a chat runtime; DSH owns messages and state                                                         |
| affectUI       | 40 free items + paid Pro; Pro forbids public source | **Design reference** only; the free/Pro badge is client-rendered, check each item before copying anything |

All of them are shadcn + Vercel AI SDK `UIMessage` shaped. Port the **view**, then feed it DSH blocks
(`ToolResultNode`, `args`, `time`/`callTime`), never the AI SDK types.

## Seams (verified in DSH 0.2.1-rc.2 types)

| Seam                                                                                                                | Use                                                                                   |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| `tool.call.toolview` keyed per tool (`bash`, `edit`, `todo_write`, …)                                               | Replace one tool's card; render the native entry as fallback (pattern in `test-runs`) |
| `conversation.chat.node` keyed by node kind (`tool-call`, `compaction`, `steering`, `turn-error`, `model-retry`, …) | Wrap or replace a node renderer (pattern in `tool-meta`)                              |
| `conversation.chat.assistant-actions`                                                                               | Per-turn footer: turn summary, checkpoint                                             |
| `conversation.input.activity`, `conversation.input.plan`, `conversation.input.dock`                                 | Live strip above the composer                                                         |

## Shared kit first (`@dshfiles/plugin-ui`)

One PR each; every later card is built from these.

| Piece                      | Port from                                         | Replaces                                              |
| -------------------------- | ------------------------------------------------- | ----------------------------------------------------- |
| `ToolCard` shell           | AI Elements `tool`, prompt-kit `tool`             | Ad-hoc header/chevron/status markup in `test-runs`    |
| `StatusTone` + `LiveTimer` | affectUI Tool Call Card (reference)               | Per-plugin icon/colour switches; `tool-meta` duration |
| `CodeBlock`                | AI Elements `code-block`, prompt-kit `code-block` | `test-runs` plain code frames                         |
| `StackTrace`               | AI Elements `stack-trace`                         | `test-runs` frames list                               |
| `Terminal`                 | AI Elements `terminal`                            | Colour-stripped bash output (ANSI → spans)            |
| `FileTree`                 | AI Elements `file-tree`                           | Flat path lists (glob, change summary)                |

## Cards, ranked

**P1** makes ongoing work easier to follow today. **P2** polishes. **—** skip.

| Card                                                                                                 | Seam                                           | Rank | What it shows                                                                                              | Host check                                                                                                     |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| **Turn summary** (affectUI Change Summary, AI Elements Commit)                                       | `assistant-actions`                            | P1   | "Edited 3 files +42 −7 · ran 6 commands (1 failed) · tests 40/42 · 1m 12s", each part opens its cards      | Needs the turn's tool blocks in that slot's props; confirm before building, else read them from the chat store |
| **Edit card** (HextaUI Diff Review, affectUI Inline Diff, Agent Elements EditTool)                   | `toolview` `edit`, `write`                     | P1   | Path, +/− counts, duration, `PatchView` hunks, copy                                                        | Args carry old/new strings; full-file diff needs a file read                                                   |
| **Plan / todo progress** (affectUI Agent Plan, AI Elements `plan` + `task`, Agent Elements TodoTool) | `toolview` `todo_write` + `input.plan`         | P1   | Steps with done/active/pending, "step 3 of 5", elapsed per step; the active step pinned above the composer | Per-step timing must come from successive `todo_write` call times                                              |
| **Tool group summary** (affectUI Tool Call Card group)                                               | `chat.node` `tool-call` wrapper                | P1   | "Ran 6 commands · 1 failed · 14 s" on the collapsed group, failed ones listed first                        | Reuses the `tool-meta` tree wrapper; one wrapper owner, not two                                                |
| **Live activity strip** (affectUI Agent Lanes, AI Elements `queue`)                                  | `input.activity`                               | P1   | What runs right now: current tool + live timer, background jobs, subagents, queued messages                | `background-jobs` and `queue-reorder` already hold the data                                                    |
| **Failure card**                                                                                     | `chat.node` `turn-error`, `model-retry`        | P1   | Readable error, retry count, "Retry" / "Ask to fix" (composer bridge from `test-runs`)                     | —                                                                                                              |
| **Context meter** (affectUI Context Window, AI Elements `context`)                                   | `input.left`                                   | P2   | Tokens used / limit, cost, next compaction                                                                 | `usage` reads per-request usage; limit per model from the model directory                                      |
| **Compaction marker** (affectUI Compact Breakdown)                                                   | `chat.node` `compaction`                       | P2   | What was summarised, tokens before/after                                                                   | Summary payload is an instruction envelope; show counts, not text                                              |
| **Subagent tree** (affectUI Agent Tree, Agent Elements SubagentTool)                                 | `toolview` `subagent` (thread-sidebar owns it) | P2   | Children with status, model, duration, last step                                                           | Extend `SubagentProvenanceToolRow`, do not add a second owner                                                  |
| **Approval card** (affectUI Approval Card / Permission Request, AI Elements `confirmation`)          | `input.permission`                             | P2   | Risk badge, command preview, keyboard shortcuts                                                            | Native `dsh-client-ui-approval` owns the decision; restyle only                                                |
| **Checkpoint** (AI Elements `checkpoint`)                                                            | `assistant-actions`                            | P2   | jj revision the turn produced, "restore to here"                                                           | `jujutsu` already resolves revisions; restore = existing jj action                                             |
| **Steering echo** (affectUI Agent Steering)                                                          | `chat.node` `steering`                         | P2   | Queued note shown where the agent picked it up                                                             | —                                                                                                              |
| **Decision inbox** (affectUI Agent/Decision Inbox)                                                   | sidebar                                        | P2   | Threads that need you, across sessions                                                                     | Blocked by the cross-thread inbox Host gap (agent-questions)                                                   |
| **Citations** (AI Elements `sources`, `inline-citation`)                                             | `toolview` web tools                           | P2   | Source chips for fetched pages                                                                             | —                                                                                                              |
| Thinking / chain of thought, message actions, reactions, voice, model picker                         | native                                         | —    | Core already renders these; no seam worth the upkeep                                                       | —                                                                                                              |

## Order

1. Kit: `ToolCard` + `StatusTone`/`LiveTimer`, then `CodeBlock`, `StackTrace`, `Terminal`; move `test-runs` onto them.
2. Edit card (new `edit-cards` plugin).
3. Tool group summary (inside `tool-meta`, which already owns the tree wrapper).
4. Plan/todo progress card + pinned step.
5. Live activity strip.
6. Turn summary — last of the P1s because it reads everything the others render.
7. Failure card, then P2s one plugin at a time.

Each step: a scratch-DSH screenshot through the fake provider (`[[call <tool> {...}]]` directives, see `test-runs`
verification) and a catalog `reach`.

## Open questions

1. Port AI Elements onto `plugin-ui`'s Radix parts, or add their deps (`streamdown`, `shiki` full, `motion`) as needed? Recommendation: Radix + existing slim Shiki, no new deps without asking.
2. Turn summary: footer under each turn (`assistant-actions`) or one sticky strip for the latest turn only?
3. Should the live activity strip replace the native `input.activity` content or sit beside it?
