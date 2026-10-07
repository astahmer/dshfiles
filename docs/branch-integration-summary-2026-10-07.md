# DSH work consolidated — 2026-10-07

The local integration combines the settled mainline, completed source workstreams, missing roadmap continuation, and the finished Workspace Restore writer. It preserves raw sources and removes empty copied revisions and temporary JJ references.

The [canonical status ledger](unification-status-2026-10-07.md) contains the complete implemented-work list, current proof, finite engineering queue, product acceptance gaps and recovery references. Earlier claims are archived and do not override that ledger.

Included: DSHX SDK/CLI and build tooling, local runtime/Controller forks, durable Agent questions/feedback, account continuity, Multi-Host, shared Plugin UI, Jujutsu restore/fork flows, daily UI plugins, adopted candidates and Project Checks. See the [catalog](../README.md).

Current proof includes 528 passing broad DSHX tests (8 failures remain), 13 passing Workspace Restore tests, browser evidence tests, and isolated synthetic core Host/restart acceptance. Settings Search lacks a native navigation seam; Thread Sidebar exposes a native/local summary contract mismatch. Combined-profile production acceptance is not claimed. No live DSH restart, push or profile promotion occurred.

The [recovery manifest](jj-unification-recovery-2026-10-07.json) preserves source tips and deleted reference targets. Workspace registrations are pruned only after source preservation; their directories remain on disk.
