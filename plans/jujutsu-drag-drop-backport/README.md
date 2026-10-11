# Jujutsu drag/drop backport

Implementation workspace: `jj-drag-drop` at `/Users/astahmer/dev/dshfiles-jj-drag-drop`.
Workspace created at base `vktwsnrw` (`631856515829cc5d1f25295d2406dea9f7028e36`, `docs(jj): close out history consolidation`). Shared JJ history later rewrote the parent; this workspace followed the rewrite to the current `main` tip without conflicts.

| Step | Status | Evidence / notes |
| --- | --- | --- |
| Reproduce/bookmark drag-state defect and record baseline | complete | Source confirms bookmark drop has no `drag.start`; baseline plugin tests pass after using local generated dependency outputs. |
| Repair bookmark drag state and invalid branch-drop feedback | pending | Add machine and UI behavior regression coverage. |
| Add inline, target-context rebase/bookmark previews and click-to-target move | pending | Preserve Host prepare/confirm tokens and error boundaries. |
| Fix Mine-only ancestry and improve ID copying | pending | Keep change-ID vs commit-ID explicit; surface clipboard failures. |
| Review push-marker evidence boundary | pending | Do not infer a pushed revision unless Host evidence binds it reliably. |
| Validate plugin, import, and meaningful UI journey | pending | No live DSH restart; use isolated verification only. |
| Describe focused revisions and prepare handoff | pending | Do not rewrite or integrate over active writers. |

## Deferred decision

Do not change revision branch ordering in this work. Compare BB recency ordering and DSH's current JJ-style branch grouping later using representative multi-head repositories.

## Resume here

Implement the bookmark drag event and regression checks first, then build inline action-context previews and click-to-target rebase.
