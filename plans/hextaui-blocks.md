# HextaUI blocks — what is left

Source: [hextaui.com/blocks](https://hextaui.com/blocks), surveyed 2026-10-19 (25 blocks: 16 AI, 9 Settings).
Shipped as design references: Test Results ([`test-runs`](../plugins/@dshfiles/test-runs/README.md) card), Agent
Todos ([`agent-plan`](../plugins/@dshfiles/agent-plan/README.md)), Code Block and Stack Trace (`CodeBlock`,
`StackTrace` and the `StackFrames` parser in [`plugin-ui`](../plugins/@dshfiles/plugin-ui/README.md#code-and-stack-traces),
adopted by test-runs and traces, with a Stack trace card under crashed bash calls), and Code Block in `read` plus Diff
Review ([`tool-meta`](../plugins/@dshfiles/tool-meta/README.md#file-tool-cards): a `read` on `CodeBlock` numbered from
its offset, `edit` / `write` / `apply_patch` on `PatchView` with one collapsible unified diff per hunk). The licence
route (MIT components may be ported with their notice, Pro blocks only rebuilt from visible behaviour, ports land on
Radix and lucide) is recorded in the plugin-ui README's
[Design references](../plugins/@dshfiles/plugin-ui/README.md#design-references).

## Open

Rank: **P1** fills a real gap in a plugin we own, **P2** polishes something that works.

| Block                | Where it would land                          | Rank | Why / Host check                                                                                                |
| -------------------- | -------------------------------------------- | ---- | --------------------------------------------------------------------------------------------------------------- |
| Subagents            | `thread-sidebar` `SubagentProvenanceToolRow` | P2   | We already own the subagent row; borrow the per-child status and duration layout.                               |
| Tool Calls           | `tool-meta`                                  | P2   | Grouped call states ("asks first", approval) — check against `dsh-client-ui-approval` before building anything. |
| Prompt Input         | `rich-composer`                              | P2   | Attachments row, model chip, stop/retry states.                                                                 |
| Chat Sidebar         | `thread-sidebar`                             | P2   | Ours already does more; compare grouping and empty states only.                                                 |
| Settings, Appearance | `settings-shell`                             | P2   | Section layout and search states only.                                                                          |
| API keys             | `secret-catalog`, `ai-accounts`              | P2   | Masked key row, copy, rotate, last-used states.                                                                 |
| Models               | `model-effort-picker`, `ai-accounts`         | P2   | Model list with provider grouping.                                                                              |
| Notifications        | `thread-sidebar` notification settings       | P2   | Per-event toggles layout.                                                                                       |
| Billing              | `usage`                                      | P2   | Usage bars and plan summary; our data is per-account usage, not billing.                                        |

Skipped for good: Artifact (native deliverables), Thinking and Chat Thread / Markdown / Streaming (no plugin seam),
Voice Mode (native bundle), HextaAI (a demo app), Profile / Security / Team (single-user harness).

## Order

1. P2 polish, one plugin at a time.
