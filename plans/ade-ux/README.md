# ADE: remaining work

Phases 0–6 shipped. The design, decisions, per-phase evidence and the migration map now live in
[docs/ade-ux](../../docs/ade-ux/README.md); this plan tracks only the open items below. When all of them close, delete it.

Browser push closed as a feasibility answer rather than shipped work: no Host gap, a plugin can serve its own service
worker and subscribe route, inject the manifest and send from the Host (see
[the attention model](../../docs/ade-ux/README.md#48-the-attention-model)).

The live `web` Host restarted on 2026-11-10 with every Host half these phases changed, so the rollout item is closed;
Done / Restore releasing and recreating the workspace is shipped (settle cleanup plus the restore-on-next-turn hook in
[jj-integration](../../plugins/@dshfiles/jj-integration/README.md#settle-cleanup)). The re-run items below were not
re-run after that restart.

- [ ] Native `ask_user_question` forms stay unproven in scratch: the Inbox provider and its answer path are covered
      Host-side (`native-question-attention.test.ts`, `attention-inbox.integration.test.ts`), but the composed scratch
      profile never reaches the New thread composer — after the fake account is added, `New session` leaves the
      AI Accounts page open, and the untouched timed-question journeys fail the same way. Fix the composition, then
      add the journey; the catalog records the same reason.

- [ ] git-worktree workspaces get only the This-turn Changes scope (the VCS port has no diff verb); no
      rebase-without-land verb (History's previewed rebase stands in).

- [ ] Live check that Unsettle or Unarchive of a thread whose workspace settle cleanup removed restores the folder on
      its next turn (source and the `threads.restore` integration tests only so far).

- [ ] Physical iPhone test; iOS back swipe moves between threads; native header, composer chips and the core font
      stepper are still under 44 px.

- [ ] Re-run on main: verification-evidence (fails at a native-sidebar step after its Activity checks),
      secret-catalog Jev chat scenarios, input-trigger entity-registry (cannot send in its composition), journey 3
      question card (did not render in scratch), subagent nesting in the browser (core tool-scheduler error).

- [ ] Multi-host journeys fail 0/6 on main too, so its Phase 1 UI is unverified.

- [ ] Pre-existing failures (2026-11-05 recount): thread-sidebar section-order and navigation-layout, the
      ai-accounts six above (jujutsu composer-context fixed 2026-11-06: its summary opens the Changes facet); workbench/main-tabs/editor journeys are flaky under load
      (workbench-terminal now has its Free docking step but its move/probe steps still flake).
