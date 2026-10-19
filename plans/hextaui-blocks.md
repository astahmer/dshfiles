# HextaUI blocks — what to adopt

Source: [hextaui.com/blocks](https://hextaui.com/blocks), surveyed 2026-10-19 (25 blocks: 16 AI, 9 Settings).

## Licence decides the route

| Part                                | Licence                                        | Route here                                                                                     |
| ----------------------------------- | ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| 65 components, 9 hooks, 5 utilities | MIT                                            | **Port** into `@dshfiles/plugin-ui` with the shadcn CLI, keeping the MIT notice and provenance |
| Prompt Input block                  | Free to install, under the HextaUI Pro License | Design reference until someone reads the Pro License for open-source redistribution            |
| The other 24 blocks                 | Paid HextaUI Pro                               | **Design reference only**: rebuild against DSH with dshx; never vendor their code              |

`test-runs` is the first one done this way: rebuilt from the published demo video, no Pro code.

Stack mismatch to settle before any port: HextaUI uses shadcn's `base-vega` style on **Base UI** primitives with
**Tabler** icons; `plugin-ui` is shadcn on **Radix** with **lucide**. A ported component either gets rewritten onto
the Radix part `plugin-ui` already has, or brings `@base-ui-components/react` in as a new dependency (ask first).

## Block-by-block

Rank: **P1** fills a real gap in a plugin we own, **P2** polishes something that works, **—** skip.

| Block                            | Where it would land                                              | Rank | Why / Host check                                                                                                                                                                                |
| -------------------------------- | ---------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Test Results                     | `test-runs`                                                      | done | Shipped as the bash-card takeover. Live counter and full height are Host gaps.                                                                                                                  |
| Diff Review                      | new `edit-cards` plugin, or `diff-viewed`                        | P1   | The video's "Edited `src/cart/pricing.ts` +2 0.7s" card: replace the `edit` / `write` tool views with a `PatchView` card (`@dshfiles/plugin-ui/diff`). Same keyed-slot takeover as `test-runs`. |
| Stack Trace                      | `plugin-ui` component, used by `test-runs` and a bash error view | P1   | Generalise the `test-runs` failure detail (code frame, collapsed framework frames) into one component; then render Node/Python traces in failed bash cards.                                     |
| Code Block                       | `plugin-ui` component                                            | P1   | `test-runs` code frames are plain mono; a shared block with Shiki (already slimmed in `src/shiki-slim.ts`), wrap toggle, copy and download serves test-runs, diffs and `read` cards.            |
| Agent Todos                      | `tool.call.toolview` key `todo_write` (check name)               | P2   | Native todo card is a list; HextaUI shows progress and the active item. Pure view over existing args.                                                                                           |
| Subagents                        | `thread-sidebar` `SubagentProvenanceToolRow`                     | P2   | We already own the subagent row; borrow the per-child status and duration layout.                                                                                                               |
| Tool Calls                       | `tool-meta`                                                      | P2   | Grouped call states ("asks first", approval) — check against `dsh-client-ui-approval` before building anything.                                                                                 |
| Prompt Input                     | `rich-composer`                                                  | P2   | Attachments row, model chip, stop/retry states. Blocked on the Pro License question above.                                                                                                      |
| Chat Sidebar                     | `thread-sidebar`                                                 | P2   | Ours already does more; compare grouping and empty states only.                                                                                                                                 |
| Artifact                         | `dsh-client-ui-deliverables` (native)                            | —    | Native deliverables cover it; a takeover would duplicate core.                                                                                                                                  |
| Thinking                         | native reasoning row                                             | —    | No plugin seam over the reasoning node worth the upkeep.                                                                                                                                        |
| Chat Thread, Markdown, Streaming | native chat                                                      | —    | Core behaviour; the markdown pipeline has no plugin seam (see `dsh-host-gaps.md`).                                                                                                              |
| Voice Mode                       | `dsh-experimental-voice-input-bundle`                            | —    | Native experimental bundle exists.                                                                                                                                                              |
| HextaAI                          | —                                                                | —    | A whole demo app, not a block.                                                                                                                                                                  |
| Settings, Appearance             | `settings-shell`                                                 | P2   | Section layout and search states only.                                                                                                                                                          |
| API keys                         | `secret-catalog`, `ai-accounts`                                  | P2   | Masked key row, copy, rotate, last-used states.                                                                                                                                                 |
| Models                           | `model-effort-picker`, `ai-accounts`                             | P2   | Model list with provider grouping.                                                                                                                                                              |
| Notifications                    | `thread-sidebar` notification settings                           | P2   | Per-event toggles layout.                                                                                                                                                                       |
| Billing                          | `usage`                                                          | P2   | Usage bars and plan summary; our data is per-account usage, not billing.                                                                                                                        |
| Profile, Security, Team          | —                                                                | —    | Single-user local harness: no accounts, sessions or members to manage.                                                                                                                          |

## Order

1. Shared `CodeBlock` and `StackTrace` in `plugin-ui`, moving `test-runs`' frame code onto them (one PR-sized change each).
2. `edit-cards`: Diff Review-style cards for file edits, reusing `CodeBlock`.
3. Stack traces in failed bash cards (same fallback pattern as `test-runs`).
4. P2 polish, one plugin at a time, starting with Agent Todos.

## Open questions

1. Is this repository published? The Pro License FAQ ("Can Pro blocks go in an open-source project?") decides whether Prompt Input can be vendored even though it is free.
2. Port MIT components onto Radix, or add Base UI to `plugin-ui`?
