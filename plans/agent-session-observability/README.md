# Agent session observability

Practical, read-only visibility across authorized DSH sessions and their JJ/workspace context, reusing the DSHX and DSH services this profile already owns. Observation must never wake, message, or otherwise modify inspected sessions. Do not alter unrelated JJ workspaces, live-profile state, or shared history.

## Progress

| Phase | State | Evidence / next gate |
|---|---|---|
| A. Discovery | complete | Native Session APIs, communication, OptMem, JJ, and DSHX contracts audited. The native Session Query tool package exists, but the checked-in web seed does not load it; registry RC2 peer contracts predate the newer workspace authorization/API changes. |
| B. Observability | partial | `dshx_comm_agents` preserves its live peer directory and adds metadata only for the caller’s direct/transitive runtime-owned descendants, checked with `AgentRegistry.isOwnedBy`. It reads no transcript and emits no raw path. Full authorized Session history/search remains gated on a compatible core package/API release. |
| C. Context | partial | Owned live descendants include runtime owner, status, creation time, and hashed cwd topic. Durable parent links are omitted because live ownership does not authorize arbitrary Session lineage. The topic is not a JJ workspace ID; task text, changed files, and revision associations remain unknown. |
| D. Orchestration | pending | No prompt, queue, cancellation, resume, or acknowledgment controls added. Keep all Session writes separately authorized. |
| E. Validation | partial | Plugin contract, typecheck, 13 tests, build/import, changed-file Oxlint/Oxfmt, and one disposable Host-report E2E pass. Frozen plugin install passes after regenerating the local-core link lock. The global feature checker still reports 81 pre-existing issues, none for this feature. No live profile sync or restart. |

## Resume here

The scoped live-directory slice is verified. For durable history/search and JJ links, wait for a compatible Session Query package/API to be published or explicitly wired into an isolated profile; the registry RC2 contract lacks the newer Host workspace authorization and the web seed does not load the local package. Do not infer transcript access from OptMem or treat peer messaging as Session history or authorization. Add a runtime E2E that invokes the scoped tool when the harness exposes a deterministic Agent ownership fixture. Keep this change on its current source revision until the conflicting `integration-spine` bookmark is resolved safely; do not rewrite other workspace heads.
