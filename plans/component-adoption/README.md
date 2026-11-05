# Component adoption: put the gallery components to work

**Written:** 2026-11-05, from an import audit of `@dshfiles/component-gallery` against `plugins/@dshfiles/*/src`.

Resume here: nothing adopted yet; start with A1 (`TraceWaterfall` in traces), then A2–A6 in table order. Each
adoption is one revision with a before/after screenshot of the screen it changes.

The gallery shows 53 demos (about 50 components) from `@dshfiles/plugin-ui`. Counts below are import files and JSX call sites in
`plugins/@dshfiles/*/src`, excluding `component-gallery`, `plugin-ui` and tests (2026-11-05,
`jj:nwvuzwry`). Recount with:

```sh
cd plugins/@dshfiles
grep -rEn --include='*.tsx' '<TraceWaterfall([ >/]|$)' */src | grep -v '^component-gallery/\|^plugin-ui/\|\.test\.'
```

## Progress

| #   | Adoption                                                                    | State       |
| --- | --------------------------------------------------------------------------- | ----------- |
| A1  | `TraceWaterfall` replaces the hand-built span tree in traces                | not started |
| A2  | `MergeChecks` replaces the Land card rows in pulls-review                   | not started |
| A3  | `TestRunResults` vs test-runs' own `FileRow`/`TestRow`: adopt or delete one | not started |
| A4  | `FallbackChain` in model-effort-picker's fallbacks section                  | not started |
| A5  | `ActivityFeed` for the Activity log rows                                    | not started |
| A6  | `RoutineList` for project-automations rows                                  | not started |
| A7  | `BulkSelectList` for the jujutsu workspace cleanup selection                | not started |
| A8  | Decide: delete or keep each "future feature" component below                | not started |

## Used outside the gallery

| Component                                                                                                             |   Files |         Call sites | Plugins                                                                                                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------- | ------: | -----------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Page`                                                                                                                |      21 |                 21 | 17: activity-timeline, agent-communication, agent-toolkit, agents, ai-accounts, background-jobs, capabilities-hub, jj-integration, mcp-servers, memory, multi-host, plugin-guide, preview, pulls-review, secret-catalog, traces, usage, worktree-memory |
| `PageSection`                                                                                                         |      13 |                 23 | 9                                                                                                                                                                                                                                                       |
| `EmptyState`                                                                                                          |      44 |                 72 | 19                                                                                                                                                                                                                                                      |
| `StatusGlyph`                                                                                                         |       3 |                  4 | jj-integration, pulls-review, thread-sidebar                                                                                                                                                                                                            |
| `EntityRow` / `EntityList`                                                                                            | 11 / 12 |            14 / 22 | 8 / 9                                                                                                                                                                                                                                                   |
| `RollingNumber` (text)                                                                                                |       6 |                  7 | background-jobs, backlog, jj-integration, traces                                                                                                                                                                                                        |
| `ShimmerText` (text)                                                                                                  |       2 |                  2 | agent-plan, test-runs                                                                                                                                                                                                                                   |
| `CheckpointGraph`                                                                                                     |       2 |                  1 | session-undo (rewind preview)                                                                                                                                                                                                                           |
| `CostWaterfall`                                                                                                       |       2 |                  1 | usage (thread Cost facet)                                                                                                                                                                                                                               |
| `PresenceList`                                                                                                        |       1 |                  1 | agent-plan (activity strip)                                                                                                                                                                                                                             |
| Motion presets / `springs` / `motion/react` hooks                                                                     |       2 |                  — | test-runs, traces (`useCountUp`, `drawStroke`, `useEnter`, `useElapsed` themselves: 0 direct imports; used inside plugin-ui)                                                                                                                            |
| Kit: `Button`, `Badge`, `StatusDot`, inputs and toggles, `Progress`, `Spinner`, `Skeleton`, `Alert`, `Kbd`, `Tooltip` |    many | 817 / 140 / 39 / … | 4–52 each; healthy                                                                                                                                                                                                                                      |

`workStatusValues` / `workStatusLabels` have no direct import, but `WorkStatus` and `StatusGlyph` from the same
module are used in 10 files; nothing to do.

## Unused outside the gallery: where to use them

Each row names the screen it replaces. "Replace" means delete the local markup; if the kit component lacks a prop
the screen needs, add it to the kit rather than forking the component.

| Component                           | Adopt in                                                                                   | What it replaces                                                                                                |
| ----------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| `TraceWaterfall`                    | traces `src/trace-detail.tsx` (`TraceDetailView`)                                          | The local `role="tree"` span list with its own grow-in animation (lines ~182–226). A1                           |
| `AgentTimeline`                     | traces `src/session-view.tsx` (`SessionTracesView`)                                        | The flat per-turn list under `SummaryGrid`: show turns, model and tool calls as one timeline                    |
| `CallStackTree`                     | traces `src/trace-detail.tsx` `SpanDetailPanel`                                            | Exception events printed as text; render `exception.stacktrace` as frames (keep `StackTrace` for raw text)      |
| `MergeChecks`                       | pulls-review `src/land-card.tsx`                                                           | The local `Row` list (behind-by, conflicts, undescribed, checks). A2                                            |
| `MergeChecklist`                    | —                                                                                          | Overlaps `MergeChecks`; keep one. Delete `MergeChecklist` once A2 picks `MergeChecks`                           |
| `MergeConflictGraph`                | jj-integration `src/thread-notices.tsx`                                                    | The text-only conflict notice: show which revisions conflict with the target                                    |
| `TestRunResults`                    | test-runs `src/test-run-card.tsx`                                                          | `FileRow` / `TestRow` / `FilterTabs`, the same shape built locally. A3: adopt it, or delete the kit copy        |
| `PipelineRun`                       | project-checks `src/client.tsx`                                                            | The receipt list: one run row per check with its log lines                                                      |
| `PipelineDag`                       | —                                                                                          | keep for a future feature: project actions with dependencies (no DAG exists today)                              |
| `FallbackChain`                     | model-effort-picker `src/fallbacks-section.tsx`                                            | The plain chain list; also usable for the "serving now" state from `model_fallback_state`. A4                   |
| `ActivityFeed`                      | activity-timeline `src/panel.tsx` (`ActivityRow`)                                          | Activity log rows (Observe › Activity)                                                                          |
| `RoutineList`                       | project-automations `src/automations-panel.tsx` (`AutomationRow`, `RunLine`)               | Automation rows with their run history. A6                                                                      |
| `WorkflowRun`                       | —                                                                                          | keep for a future feature: an owned `workflow` tool card (the transcript renders the native one)                |
| `BulkSelectList`                    | jujutsu `src/workspace-cleanup-dialog.tsx`                                                 | The checkbox list of cleanup targets. A7                                                                        |
| `AgentRoster`                       | agent-communication `src/agent-communication-panel.tsx` (`DiagnosticPanel`, `AgentStatus`) | The live agent list with status pills                                                                           |
| `DelegationBoard`                   | —                                                                                          | keep for a future feature: ADE Phase 7 fan-out approval card (`plans/ade-ux` §8)                                |
| `DelegatorBoard`                    | —                                                                                          | keep for a future feature: Inbox grouped by source ("Needs you · Release · Agents")                             |
| `AgentQueue`                        | —                                                                                          | keep for a future feature: host-pool / multi-host work queue view                                               |
| `AgentRunSteps`                     | agent-plan `src/plan-steps.tsx`                                                            | The local step list; `step-glyph` is already shared, the row shape is not                                       |
| `AgentRunStatus`                    | —                                                                                          | keep for a future feature: subagent card in the parent transcript (child status pills, Phase 7)                 |
| `StepTrail`                         | agent-plan `src/activity-strip.tsx`                                                        | The live activity strip's step labels                                                                           |
| `ActivityDock`                      | —                                                                                          | keep for a future feature: the ADE walkthrough card at turn end (Phase 4 open item)                             |
| `SessionRecap`                      | turn-summary `src/turn-summary-line.tsx`                                                   | Same walkthrough card; pick one of `ActivityDock` / `SessionRecap` for it and delete the other                  |
| `ApprovalRun`                       | —                                                                                          | keep for a future feature: fan-out approval card (owned chat fork `ApprovalCommand.tsx` is the native approval) |
| `ClarifyPrompt`                     | —                                                                                          | keep for a future feature: an owned ask_user_question card (user-questions renders the native fork)             |
| `ToolbarWalkthrough`                | —                                                                                          | keep for a future feature: plugin-guide onboarding tour                                                         |
| `ShapeshiftCard`                    | —                                                                                          | keep for a future feature: palette quick actions that morph into a form                                         |
| `ContextGraph`                      | agent-toolkit `src/context-facet.tsx`                                                      | Optional graph view of the Context facet sections (instruction files → skills → MCP)                            |
| `CheckpointGraph`                   | (used)                                                                                     | Also fits jujutsu's reference graph only if that loses its lane graph; leave                                    |
| `RevisionScrubber`                  | —                                                                                          | keep for a future feature: "rewind any turn" (t3code parity B3)                                                 |
| `RevisionAvatarGraph`               | —                                                                                          | keep for a future feature: thread-share v2 collaborative threads (who changed what)                             |
| `AgentCursors` / `AgentPresenceBar` | —                                                                                          | keep for a future feature: thread-share v2 presence                                                             |
| `CreditsUsage`                      | ai-accounts `src/usage-card-view.tsx`                                                      | Quota bars per account in Usage › Quota                                                                         |
| `SpendMap`                          | usage `src/charts.tsx`                                                                     | The per-project/model breakdown panels                                                                          |
| `AccessMap`                         | —                                                                                          | keep for a future feature: policies / sandbox scope view (no owned policies UI yet)                             |
| `Typewriter`                        | —                                                                                          | keep for a future feature: none known; delete at A8 if still unused                                             |

## Follow-ups owned elsewhere

The workbench tabs and "Choose a view" chooser, `@dshfiles/editor`, the frame-layout status strip and backlog remote
sync have other owners right now. Do not adopt components there from this plan; note candidates in their own plans.

## Done when

Every row above is adopted (with a screenshot), deleted from `plugin-ui` and the gallery, or kept with a named
feature that has a plan. Then run `complete-plan`: the "used outside" table moves into
[plugin-ui's README](../../plugins/@dshfiles/plugin-ui/README.md) as a usage note, and this plan is deleted.
