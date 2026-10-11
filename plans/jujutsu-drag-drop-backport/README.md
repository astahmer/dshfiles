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
| Validate plugin, import, and meaningful UI journey | in progress | Targeted browser run exposed a lost untracked step helper; restore, run in isolated profile, and report known catalog baseline failures separately. |
| Describe focused revisions and prepare handoff | pending | Split only owned paths; do not rewrite or integrate over active writers. |

## Deferred decision

Do not change revision branch ordering in this work. Compare BB recency ordering and DSH's current JJ-style branch grouping later using representative multi-head repositories.

## Resume here

Finish plugin type/test/build and host-import checks, run the isolated Jujutsu browser journeys, then split owned paths and leave an integration handoff. Revision ordering remains explicitly deferred.
