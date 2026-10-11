# Jujutsu drag/drop backport

Implementation workspace: `jj-drag-drop` at `/Users/astahmer/dev/dshfiles-jj-drag-drop`.
Workspace created at base `vktwsnrw` (`631856515829cc5d1f25295d2406dea9f7028e36`, `docs(jj): close out history consolidation`). Shared JJ history has auto-rewritten the parent several times; keep this source workspace separate from active siblings and do not integrate over them.

| Step | Status | Evidence / notes |
| --- | --- | --- |
| Reproduce/bookmark drag-state defect and record baseline | complete | Source confirms bookmark drop has no `drag.start`; baseline plugin tests pass after using local generated dependency outputs. |
| Repair bookmark drag state and invalid branch-drop feedback | complete | Both MIME types enter `dragging`; machine tests cover bookmark origin, matching leave, and visible descendant-drop rejection. |
| Add contextual rebase/bookmark previews and click-to-target move | complete | Host prepare/confirm remains the mutation boundary; previews stay pinned across filters, retain details while confirming, and can be cancelled before confirm. |
| Fix Mine-only ancestry and improve ID copying | complete | Hidden immutable ancestry bridges with dashed rails; full change ID and this-revision commit ID have distinct labels and clipboard feedback. |
| Review push-marker evidence boundary | complete | UI reports only the most recent JJ push-command invocation; it does not attribute a pushed revision. |
| Validate plugin, import, and meaningful UI journey | in progress | Typecheck, 100 tests, build, and Host import pass. Feature tags/catalog entries are recognized; 82 unrelated coverage baseline issues remain. Isolated browser journey now registers a disposable repo and reaches its graph, but the full interaction scenario still needs a successful run. |
| Describe focused revisions and prepare handoff | in progress | Source and E2E changes are split into described revisions. Keep source workspace intact; do not integrate across active writers without tree-preservation proof. |

## Deferred decision

Do not change revision branch ordering in this work. Compare BB recency ordering and DSH's current JJ-style branch grouping later using representative multi-head repositories.

## Resume here

Finish the isolated preview and ID journeys, rebuild all plugin-ui dependents after UI class changes, run format and feature checks, then record source commit IDs and exact integration handoff. Do not integrate while shared writers are active. Revision ordering remains explicitly deferred.
