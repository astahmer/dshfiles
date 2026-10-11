# Jujutsu drag/drop backport

Implementation workspace: `jj-drag-drop` at `/Users/astahmer/dev/dshfiles-jj-drag-drop`.
Workspace created at base `vktwsnrw` (`631856515829cc5d1f25295d2406dea9f7028e36`, `docs(jj): close out history consolidation`). Shared JJ history has auto-rewritten the parent several times; keep this source workspace separate from active siblings and do not integrate over them.

| Step | Status | Evidence / notes |
| --- | --- | --- |
| Reproduce/bookmark drag-state defect and record baseline | complete | Bookmark drop previously missed `drag.start`; tests cover both MIME types, leave handling, and descendant rejection. |
| Repair bookmark drag state and invalid branch-drop feedback | complete | Both MIME types enter `dragging`; invalid descendant drops show feedback without mutation. |
| Add contextual rebase/bookmark previews and click-to-target move | complete | Host prepare/confirm remains authoritative; the pinned preview survives filtering, and the disposable browser journey verifies branch/bookmark previews, click-to-target, cancel, and unchanged history. |
| Fix Mine-only ancestry and improve ID copying | complete | Hidden immutable ancestry bridges with dashed rails; the browser journey verifies exact full change ID and current-revision commit ID clipboard values. |
| Review push-marker evidence boundary | complete | UI reports only the most recent JJ push-command invocation; it does not attribute a pushed revision. |
| Validate Jujutsu plugin and browser journeys | complete | Typecheck, 18 test files / 100 tests, build, Host import, and both focused E2E scenarios pass. The isolated boot helper includes local external bundles. Normal DSHX build is blocked by TS7053 in `tooling/dshx/packages/dshx/src/sdk/client.ts:181`; ignored DSHX output was refreshed from source with `--noEmitOnError false` for this run. No live profile sync or restart was performed. |
| Rebuild all `plugin-ui` dependents | partial | `shared-runtime` and 12 dependents built (13/21 total). Eight are blocked by unrelated current-tree errors: `thread-sidebar` TS2698; `project-checks`, `agent-communication`, `ai-accounts`, and `optmem` missing `@deepseek-ai/dsh-agent`; `model-effort-picker` rejects capability `models` and has type errors; `queue-reorder` has missing inbox/agent types; `project-folder-picker` has no `build` script. Leave those sources untouched. |
| Feature-catalog check | partial | `features:check` reports 83 workspace-wide issues, including legacy untagged scenarios; the new Jujutsu tags are accepted. It also reports the unrelated `shared-runtime` manifest lacks a feature-catalog reference. |
| Prepare safe integration handoff | complete | Source changes are described in JJ revisions below. Keep this workspace intact; defer integration while shared writers remain active. The validation-only symlink `tooling/dsh-core/api-session-controller/lib` is unowned and must not be included. |

## Deferred decision

Do not change revision branch ordering in this work. Compare BB recency ordering and DSH's current JJ-style branch grouping later using representative multi-head repositories.

## Handoff

Source workspace: `jj-drag-drop` at `/Users/astahmer/dev/dshfiles-jj-drag-drop`. Latest implementation/test revision before this closeout: `30878475f26290ab23e0b252e63dff7e934db6ad`; this handoff is committed immediately after it. Notable anchors are implementation `339f6c3171a9b11b05cd0a93be5f0ff5e0877e17`, persistent-preview fix `115d2cf6593e0f3fa2892c74629422563c9e8199`, and isolated external-bundle boot fix `1813da51e667bdc182c74e939eb71020a61b5f42`.

Do not integrate or push yet. Active sibling workspaces share this JJ store; create a separate integration workspace from the latest compatible tip after writers settle, copy/rebase only the described task revisions, and verify tree equality and clean status before retiring the source workspace. No runtime profile was synced, and branch ordering remains deferred.

## Resume here

After sibling writers settle, integrate from the task revisions above in a separate workspace. Revisit the eight blocked plugin builds only after their unrelated type/build causes are addressed; keep the live DSH instance untouched.
