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

The Host already ships most of what the libraries offer, in `@deepseek-ai/dsh-client-ui-primitives`: `CodeBlock`,
`CodeToolbar`, `TerminalBlock` (ANSI), `DisclosureRow` (the native 24px process row), `TextShimmer` and
`useCodeHighlighter` (Shiki themed by the Host's `--shiki-token-*` variables). The kit wraps those instead of
porting library code, so cards look native and follow the theme.

| Piece                                 | Status                               | Built on                                                                                   |
| ------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------ |
| `ToolCard`, `StatusIcon`              | done (`components/tool-card`)        | `DisclosureRow`; status glyphs for a step (`row`) or a file/run (`group`)                  |
| `CodeFrame`, `StackTrace`, `FilePath` | done (`components/stack-trace`)      | `useCodeHighlighter`; keeps the file's own line numbers, which the Host `CodeBlock` cannot |
| Terminal                              | not needed                           | Use the Host `TerminalBlock` directly                                                      |
| `LiveTimer`                           | local in `agent-plan` (`useNow`)     | Kept local until a second plugin needs one; then move it into the kit                      |
| `FileTree`                            | not needed yet                       | The turn summary lists edited files flat (path + `+N −M`); a tree waits for a real need   |

## Cards, ranked

**P1** makes ongoing work easier to follow today. **P2** polishes. **—** skip.

| Card                                                                                                 | Seam                                           | Rank   | What it shows                                                                                                                                                                                                                                           | Host check                                                                                                                   |
| ---------------------------------------------------------------------------------------------------- | ---------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **Turn summary** (affectUI Change Summary, AI Elements Commit)                                       | `turnTail` (not `assistant-actions`)           | done   | Shipped in `@dshfiles/turn-summary`: "Edited 3 files +42 −7 · ran 6 commands · 1 failed · tests 40/42 · 1m 12s"; files, commands and failures open their lists, files open in the editor                                                         | `assistant-actions` owner props carry only the message id; `turnTail` carries the turn, its data and `openFile`             |
| **Edit card** (HextaUI Diff Review, affectUI Inline Diff, Agent Elements EditTool)                   | `toolview` `edit`, `write`                     | native | Checked 2026-10-19 in a scratch DSH: the native row already shows path, size and +/− counts, expands to a language-labelled diff that folds long hunks, has Inspect, and the turn gets an "Edited pricing.ts +4 −1" chip; `tool-meta` adds the duration | A takeover would duplicate core. Revisit only for extras the native card lacks (line numbers, wrap/copy toolbar on the diff) |
| **Plan / todo progress** (affectUI Agent Plan, AI Elements `plan` + `task`, Agent Elements TodoTool) | `toolview` `todo_write` + `input.plan`         | done   | Shipped in `@dshfiles/agent-plan`: steps with done/active/pending, "Step 2 of 3", elapsed per step; the current step pinned beside the native plan-mode chip                                                                                            | Timing from successive `todo/write` event times, followed across turns while the plan keeps a step                          |
| **Tool group summary** (affectUI Tool Call Card group)                                               | `turnTail` + turn Definition                   | done   | Shipped as `@dshfiles/turn-summary`: "Ran 6 commands · edited 3 files · 1 failed ›" under each finished turn, failures listed                                                                                                                           | The step group header has no seam (Host gap); the line lives under the turn instead                                          |
| **Live activity strip** (affectUI Agent Lanes, AI Elements `queue`)                                  | `input.activity`                               | done   | Shipped in `@dshfiles/agent-plan`: running tool calls with a live timer, background jobs, subagents; queued messages stay in the native queue dock                                                                                                       | Neither `background-jobs` nor `queue-reorder` exports a contract module; the strip reads `tool/*` and `job/*` Session events |
| **Failure card**                                                                                     | `chat.node` `turn-error`, `model-retry`        | done   | Shipped in `@dshfiles/agent-plan`: retry count, "Retry" / "Ask to fix" under the native row, through the dshx `Composer` contract (writes, never sends)                                                                                                  | Actions need a `Composer` provider (`@dshfiles/rich-composer`)                                                               |
| **Context meter** (affectUI Context Window, AI Elements `context`)                                   | `input.left`                                   | P2     | Tokens used / limit, cost, next compaction                                                                                                                                                                                                              | `usage` reads per-request usage; limit per model from the model directory                                                    |
| **Compaction marker** (affectUI Compact Breakdown)                                                   | `chat.node` `compaction`                       | P2     | What was summarised, tokens before/after                                                                                                                                                                                                                | Summary payload is an instruction envelope; show counts, not text                                                            |
| **Subagent tree** (affectUI Agent Tree, Agent Elements SubagentTool)                                 | `toolview` `subagent` (thread-sidebar owns it) | P2     | Children with status, model, duration, last step                                                                                                                                                                                                        | Extend `SubagentProvenanceToolRow`, do not add a second owner                                                                |
| **Approval card** (affectUI Approval Card / Permission Request, AI Elements `confirmation`)          | `input.permission`                             | P2     | Risk badge, command preview, keyboard shortcuts                                                                                                                                                                                                         | Native `dsh-client-ui-approval` owns the decision; restyle only                                                              |
| **Checkpoint** (AI Elements `checkpoint`)                                                            | `assistant-actions`                            | P2     | jj revision the turn produced, "restore to here"                                                                                                                                                                                                        | `jujutsu` already resolves revisions; restore = existing jj action                                                           |
| **Steering echo** (affectUI Agent Steering)                                                          | `chat.node` `steering`                         | P2     | Queued note shown where the agent picked it up                                                                                                                                                                                                          | —                                                                                                                            |
| **Decision inbox** (affectUI Agent/Decision Inbox)                                                   | sidebar                                        | P2     | Threads that need you, across sessions                                                                                                                                                                                                                  | Blocked by the cross-thread inbox Host gap (agent-questions)                                                                 |
| **Citations** (AI Elements `sources`, `inline-citation`)                                             | `toolview` web tools                           | P2     | Source chips for fetched pages                                                                                                                                                                                                                          | —                                                                                                                            |
| Thinking / chain of thought, message actions, reactions, voice, model picker                         | native                                         | —      | Core already renders these; no seam worth the upkeep                                                                                                                                                                                                    | —                                                                                                                            |

## Order

1. ~~Kit: `ToolCard`, `StatusIcon`, `CodeFrame`, `StackTrace`; `test-runs` moved onto them.~~ Done.
2. ~~Edit card~~: covered by the native `edit`/`write` cards (see the table).
3. ~~Tool group summary~~: done as `@dshfiles/turn-summary` (under the turn; the group header has no seam).
4. ~~Plan/todo progress card + pinned step.~~ Done in `@dshfiles/agent-plan`.
5. ~~Live activity strip.~~ Done in `@dshfiles/agent-plan`.
6. ~~Turn summary~~: done in `@dshfiles/turn-summary` (line counts, tests, duration, lists).
7. ~~Failure card~~ done in `@dshfiles/agent-plan`; then P2s one plugin at a time.

**Resume here:** promote `@dshfiles/agent-plan` into `profiles/web`, then the P2s (context meter first).

Each step: a scratch-DSH screenshot through the fake provider (`[[call <tool> {...}]]` directives, see `test-runs`
verification) and a catalog `reach`.

## Decisions

1. Build on the Host primitives and `plugin-ui`'s Radix parts; no new dependencies from the libraries (`streamdown`, full Shiki, `motion`).
2. Turn summary is a footer under each turn (`turnTail`; see 5).
3. Every card is configurable: its plugin registers a `defineSettings` namespace (`applies: 'live'`) with an `enabled` switch plus one switch per behaviour, and the catalog `configuration` lists each key. Turning a card off falls back to the native view.
4. The live activity strip and the pinned step sit **beside** the native `input.activity` / `input.plan` occupants
   (voice input, plan-mode chip), never replace them. Both are single slots whose occupants take injected props, so
   `agent-plan` wraps the occupant in place (the `tool-meta` pattern) and registers its own entry at priority 100 only
   for profiles with no native occupant.
5. The turn summary stays in `turnTail`: `assistant-actions` gets only a message id.

## Progress

| Step                      | State | Where                                                                                                          |
| ------------------------- | ----- | -------------------------------------------------------------------------------------------------------------- |
| 4 Plan card + pinned step | done | `@dshfiles/agent-plan` (`plan-card`, `pinned-step`), journeys `agent-plan.plan-card`, `agent-plan.pinned-step` |
| 5 Live activity strip | done | `@dshfiles/agent-plan` (`live-activity-strip`), journey `agent-plan.activity-strip` |
| 6 Turn summary footer | done | `@dshfiles/turn-summary` (`turn-summary-line`), unit `turn-summary.model-footer` |
| 7 Failure card | done | `@dshfiles/agent-plan` (`failure-card`), journey `agent-plan.failure-card` |

Scratch caveat (2026-11-04): with the workspace's own core (`node_modules/@deepseek-ai/dsh`) every scratch and journey
tool call crashed with "Cannot read properties of undefined (reading 'prepare')": that install's `dsh-base` links
`@deepseek-ai/dsh-tools@0.2.1-rc.2(cfc185…)` while its `dsh-agent-loop` links the `(e82ac2…)` peer variant, so the
agent loop's `registry[TOOL_RUNTIME_SCHEDULER]` symbol lookup misses. `main`'s lockfile already carries both variants
and the crash reproduces without `agent-plan`. Verified instead with `DSHX_DSH_EXECUTABLE` pointing at a flat 0.2.1-rc.2
install that has one `dsh-tools`. The reaches use the `jev-setup-chat-thread` seed so they need no tool call to set up.

## Open questions

None open for the P1s.
