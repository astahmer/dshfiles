# ADE: remaining work

Phases 0–6 shipped. The design, decisions, per-phase evidence and the migration map now live in
[docs/ade-ux](../../docs/ade-ux/README.md); this plan tracks only the open items below. When all of them close, delete it.

- [ ] Restart the live DSH Host when convenient. Host halves changed in activity-timeline, agent-questions,
      thread-sidebar, jj-integration, ai-accounts, backlog, traces, hmr-gate, diff-viewed, agent-toolkit, references,
      settings-shell and memory; rebuild the canonical checkout first (`dshx checkout sync`).

- [ ] Browser push for blocking items (needs a Host/service-worker feasibility check; record a Host gap only if no
      plugin route works).

- [ ] Native `ask_user_question` forms reach the Inbox in scratch (provider covers timed-schema forms only).

- [ ] Done / Restore releases and recreates the workspace (C3 in [t3code parity](../t3code-parity.md)).

- [ ] git-worktree workspaces get only the This-turn Changes scope (the VCS port has no diff verb); no
      rebase-without-land verb (History's previewed rebase stands in).

- [ ] Physical iPhone test; iOS back swipe moves between threads; native header, composer chips and the core font
      stepper are still under 44 px.

- [ ] Re-run on main: verification-evidence (fails at a native-sidebar step after its Activity checks),
      secret-catalog Jev chat scenarios, input-trigger entity-registry (cannot send in its composition), journey 3
      question card (did not render in scratch), subagent nesting in the browser (core tool-scheduler error).

- [ ] Multi-host journeys fail 0/6 on main too, so its Phase 1 UI is unverified.

- [ ] Pre-existing failures (2026-11-05 recount): thread-sidebar section-order and navigation-layout, the
      ai-accounts six above (jujutsu composer-context fixed 2026-11-06: its summary opens the Changes facet); workbench/main-tabs/editor journeys are flaky under load
      (workbench-terminal now has its Free docking step but its move/probe steps still flake).
