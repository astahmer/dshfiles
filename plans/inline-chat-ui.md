# Inline chat UI — remaining P2 cards

Goal: someone glancing at a thread can tell **what the agent is doing, what it changed, what it is waiting on, and
what failed**, without opening terminal dumps. The P1 cards and the first P2 shipped and are documented where they
live: the kit pieces (`ToolCard`, `StatusIcon`, `StackTrace`, `CodeFrame`) in the
[plugin-ui README](../plugins/@dshfiles/plugin-ui/README.md), the plan card, pinned step, live activity strip,
failure card and compaction meter in [agent-plan](../plugins/@dshfiles/agent-plan/README.md) (its next-compaction
trigger in [context-compaction](../plugins/@dshfiles/context-compaction/README.md#next-compaction)), and the turn
summary in [turn-summary](../plugins/@dshfiles/turn-summary/README.md). Edit cards stay native. This file keeps only
the P2 cards nobody built yet. [HextaUI](hextaui-blocks.md) is planned separately.

## Licences

| Source         | Licence                                             | Route                                                                                                     |
| -------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| AI Elements    | Apache-2.0                                          | **Port**: keep `LICENSE` + `NOTICE`, mark changed files                                                   |
| prompt-kit     | MIT                                                 | **Port**                                                                                                  |
| Agent Elements | MIT (small, last push 2026-04)                      | **Port** pieces; do not depend on it                                                                      |
| simple-ai      | MIT                                                 | **Port** pieces                                                                                           |
| affectUI       | 40 free items + paid Pro; Pro forbids public source | **Design reference** only; the free/Pro badge is client-rendered, check each item before copying anything |

Port the **view**, then feed it DSH blocks (`ToolResultNode`, `args`, `time`/`callTime`), never the AI SDK types.
Build on the Host primitives and `plugin-ui`; no new dependencies from the libraries (`streamdown`, full Shiki,
`motion`). Every card registers a `defineSettings` switch (`applies: 'live'`) and falls back to the native view when
off.

## P2 audit (2026-11-10)

| Card                                                                                        | State           | Owner / note                                                                                                                                                                                       |
| ------------------------------------------------------------------------------------------- | --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Context meter** (affectUI Context Window, AI Elements `context`)                          | done            | Ring and breakdown: native `dsh-token-meter` projections drawn by `rich-composer`. Cost: `ai-accounts`. Next compaction: `agent-plan` meter-line chip over the `context-compaction` threshold API. |
| **Compaction marker** (affectUI Compact Breakdown)                                          | already existed | `chat` fork's `compaction` node: "Compacted N history items (~X tokens)", summary on expand                                                                                                        |
| **Subagent tree** (affectUI Agent Tree, Agent Elements SubagentTool)                        | already existed | `thread-sidebar` `SubagentProvenanceToolRow`: name, model, working/done state, live preview of the child's steps. No per-child duration                                                            |
| **Steering echo** (affectUI Agent Steering)                                                 | already existed | `chat` fork renders steering rows where the agent took them, plus the pending steering bubble                                                                                                      |
| **Decision inbox** (affectUI Agent/Decision Inbox)                                          | already existed | `activity-timeline` Inbox ("Needs you" across threads) with the `attention_*` agent tools                                                                                                          |
| **Checkpoint** (AI Elements `checkpoint`)                                                   | partly          | `session-undo` rewinds to before any recorded turn, files included. Missing: the jj revision a turn produced, shown on the turn                                                                    |
| **Approval card** (affectUI Approval Card / Permission Request, AI Elements `confirmation`) | open            | `input.permission`; native `dsh-client-ui-approval` owns the decision, restyle only                                                                                                                |
| **Citations** (AI Elements `sources`, `inline-citation`)                                    | open            | `tool.call.toolview` for the web tools (`web-fetch-readable` and `web-search-brave` have no client yet): source chips for fetched pages                                                            |

## Open cards

1. **Citations.** Wrap the native `web_fetch` / `web_search` rows (the `tool-meta` pattern) and add one chip per
   source URL: host name, opens the page. Owner: a client half in `web-fetch-readable`, or `agent-plan` if both web
   tools should share it.
2. **Checkpoint revision.** On each finished turn (`turnTail`, not `assistant-actions`: that seat carries only the
   message id), name the jj revision the turn's edits landed in, linked through `jujutsu`; "restore to here" reuses
   `session-undo`'s rewind. Needs a turn → revision mapping: `session-undo` records the jj operation at turn start,
   not a revision.
3. **Approval card.** Restyle `input.permission` (risk badge, command preview, keyboard hints) without taking the
   decision from the native approval package.

Each card: a scratch-DSH screenshot through the fake provider (`[[call <tool> {...}]]` directives) and a catalog
`reach`.
