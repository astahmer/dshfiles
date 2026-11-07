# Plans

A plan lives here only while work remains. When its last task is done and
verified, run the [`complete-plan`](../.agents/skills/complete-plan/SKILL.md)
skill: the decisions, limits, final behavior and verification commands move
into the docs that own the behavior (a package README or its `docs/`,
`tooling/dshx/docs`, or [`docs/`](../docs/README.md) for cross-cutting topics),
and the plan is deleted. A partly done plan is trimmed to its open items, with
a link to where the finished part is documented. Shipped behavior is never
documented only here.

Checkboxes and receipts in a plan are history, not fresh verification.

## Product and plugin work

| Plan                                                                 | Open work                                                                                                                                                                                         |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agent session history](agent-session-history.md)                    | Bounded, permission-scoped Session search and read tools for Agents. Not started on stock DSH: its route went through a core fork, and `dshx_comm_history` covers live descendants only.          |
| [Agent session observability](agent-session-observability/README.md) | Wider history access, JJ change associations, orchestration writes, a scratch check.                                                                                                              |
| [Async Agent questions](async-agent-questions.md)                    | Cross-thread inbox Host gap, root timed acceptance, real-provider child run, element anchors.                                                                                                     |
| [fff search](fff-search/README.md)                                   | `fff-search` shipped (DSH grep ~10x faster per call) and is in the `web` profile; open: larger-corpus and reasoning-model runs.                                                                   |
| [Multi-host](multi-host/README.md)                                   | Plugin provisioning/SSH scratch E2E shipped; target/service owner, durable service, supervisor token boundary, and Linux release acceptance remain.                                               |
| [Fleet DX](fleet-dx/README.md)                                       | t3code parity for remote machines: fleet update dialog, version banner, remote subagents, failure diagnosis, exact-thread Host UI, weights, jj sync.                                              |
| [Verification evidence](verification-evidence.md)                    | Minimize peer metadata in Activity events; expose verification stage and regressions.                                                                                                             |
| [Remote threads as real threads](remote-thread-composer/README.md)   | A remote Session opening in this client's native chat and composer: mirror source, journal re-serve, prompt forwarding, per-session models, uploads.                                              |
| [pulls.review-style thread review](pulls-review/README.md)           | Host API, review panel, command and palette action, scratch-DSH verification.                                                                                                                     |
| [VCS adapters](vcs-adapters/README.md)                               | Thread workspaces, automatic fetch and pulls-review work in git-only repositories; open: the jujutsu graph panel for git and git browser journeys.                                                |
| [Backlog](backlog/README.md)                                         | Agent triage, lifecycle signals from threads/revisions/PRs, `@b:` mentions and backlinks, rich bodies, Discord import.                                                                            |
| [Backlog v2](backlog/v2.md)                                          | SQLite op log + short ids, agent items hidden by default, shipped digest, ready queue/priority/hierarchy, multi-account provider port (Linear, GitHub, files, Notion, Jira), multi-host peers.    |
| [Secret input binding](secret-input/README.md)                       | `data-secret-input` shipped for settings, Backlog and MCP servers; open: AI Accounts refs.                                                                                                        |
| [DOM hook refactor](dom-hook-refactor.md)                            | Replace transcript/stat/frame/thread DOM mutations with typed owner-rendered extension points.                                                                                                    |
| [HextaUI blocks](hextaui-blocks.md)                                  | Port MIT components; rebuild Pro blocks as references: shared CodeBlock/StackTrace, edit cards, bash stack traces, then P2 polish.                                                                |
| [Inline chat UI](inline-chat-ui.md)                                  | Shared tool-card kit, edit cards, tool-group summary, plan progress, live activity strip, turn summary; ported from AI Elements / prompt-kit, affectUI as reference.                              |
| [Typed chat drafts](typed-chat-drafts/README.md)                     | Activation only: the user picks a restart, then the New chat / typed-draft GUI check.                                                                                                             |
| [ADE: remaining work](ade-ux/README.md)                                                                | Phases 0–6 shipped; the design and evidence live in [docs/ade-ux](../docs/ade-ux/README.md). Open: nine follow-ups (a Host restart, browser push, native question forms in the Inbox, Done/Restore recreating the workspace, git-worktree scopes, a physical iPhone pass). |
| [Thread sharing](thread-share/README.md)                             | v1 shipped as `@dshfiles/thread-share` (opt-in, not seeded); open: v2 collaborative threads (design and risks only), opentunnel revisit.                                                          |
| [Component adoption](component-adoption/README.md)                   | Use the gallery components that no plugin imports yet: TraceWaterfall in traces, MergeChecks in the Land card, TestRunResults, FallbackChain, ActivityFeed, RoutineList; delete or keep the rest. |
| [Browser preview panel](browser-preview-panel.md)                    | Pane, new-tab fallback and Agent browser mirror shipped; open: live check after restart, auto-reveal, remote-GUI Open, mirror perf, hand-off.                                                     |
| [t3code parity](t3code-parity.md)                                    | Gaps against t3code nightly: create a PR from a thread (C1), scheduled tasks and webhooks (B5), rewind any turn (B3), request_secret (B7). A6, C2, B4 and C3 shipped.                             |

## Testing, research and housekeeping

| Plan                                                                 | Open work                                                                                                                                                                                                               |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Plugin E2E coverage](plugin-e2e-coverage.md)                        | Run journeys in CI, a fresh baseline, Host egress, catalog scaffolding.                                                                                                                                                 |
| [Host gaps](dsh-host-gaps.md)                                        | Behaviors our plugins cannot build until DSH exposes a capability. A decision register (own / upstream / drop), not a task plan.                                                                                        |
| [Reference feature additions](reference-feature-additions.md)        | Evidence-gated feature and adoption backlog from reference products.                                                                                                                                                    |
| [Competitor releases 2026-11](competitor-releases-2026-11/README.md) | Ranked gaps from competitor releases of 2026-10-07 → 11-04: tool/instruction diet, idle compaction, resume-cost warning, thread artifacts, child approvals in the parent, find in thread.                               |
| [Self-improvement](self-improve/README.md)                           | Open improvements mined from DSH Session history (jj hardening, fetch provider, checkout-sync fan-out, store folds, context diet); the ledger dedups and reopens them. A standing backlog, not a task plan.             |
| [Data fetching](data-fetching/README.md)                             | A fresh-load HAR spent 99 % of request time queued in the browser (HTTP/1.1, six sockets): batched dshx transport, page-wide resource store usable from React and later Foldkit, event-tag invalidation, P0 poll fixes. |
| [Performance optimization](performance-optimization/README.md)       | Remaining client, Host and tooling work packages from the repository-wide audit, then full representative before/after acceptance.                                                                                      |
| [Lint cleanup](lint-cleanup/README.md)                               | Remove the ratcheted lint baseline with real fixes and lower each cap as a rule empties.                                                                                                                                |
| [Effect-native follow-ups](effect-native-follow-ups/README.md)       | Leftovers of the Effect migration branch: fff-search on Linux, session-search index store, memory bench, core-owned HAR requests, batched `jj:` lookups, a fresh HAR.                                                   |

## Open follow-ups

Leftovers of finished plans. The plan files were deleted; each line links to the doc that now owns the topic.

- **HMR gate** ([design](../plugins/@dshfiles/hmr-gate/docs/design.md)): confirm in a scratch DSH with Host HMR enabled
  that `hmr/reload` releases a deferral, watch a client-only rebuild apply live, and decide whether the Plugins row
  gains retry and page-reload actions.
- **Host loop freezes** ([Host loop freezes](../plugins/@dshfiles/session-search/docs/host-loop-freezes.md)): measure
  the idle background tax of the activity timeline and usage store writes against the 5 ms/s gate; never measured.
- **Workbench main view** ([docking decisions](../plugins/@dshfiles/workbench/docs/docking-decisions.md#the-main-view)):
  the user restarts the `web` Host and confirms the Workbench centre live.
- **Capabilities hub** ([README](../plugins/@dshfiles/capabilities-hub/README.md#skillssh)): in-app skills.sh search
  and install wait for an official authenticated catalog contract.
- **Plugin guide** ([README](../plugins/@dshfiles/plugin-guide/README.md#decisions)): live slot occupancy needs a
  Host-owned typed read API, designed and approved first.

## Proposed, not started

Ideas that were investigated but never built. Their plan files were deleted; this line is what survives. Reopen one by
writing a new plan.

- **Agent Calendar** (2026-11-05). A retrospective turn-time Calendar tab inside Usage, built from `turn/start` and
  `turn/end` markers: wall-clock agent time per project and Session, never claiming billable time or mixing duration
  with token usage. Direction: a Host projection table, Day/3-day/Week views and CSV, reusing Usage so no second
  analytics owner appears.
- **External usage history** (2026-11-05). Opt-in, cross-harness token usage inside Usage. TokiToki already reports
  other harnesses locally, so DSH integration must justify its privacy cost with native charts; Codex rollout and
  OpenCode stores are best-effort sources, Claude OTel is forward-only and Cursor has no documented local schema.
- **~/dev cleanup** (2026-10-13). A read-only audit of `~/dev` left 23 workspaces and repositories needing the owner's
  keep/archive/remove call, including a 28-workspace store whose 34 commits exist only locally. Re-run the audit before
  acting; nothing there is removed without the owner's decision.

- **Slot assembly crash safety** (2026-10-19). A recomposition that briefly leaves the sole `root` slot owner
  (`frame-layout`) with zero registrations makes the stock renderer throw `SlotAssemblyError` past every error boundary
  and blanks the Web UI until a reload. Direction: register a shadowed fallback `root` entry that shows a recovery card,
  and record the renderer and shell half as a Host gap.
- **Shared account pool** (2026-10-22, research only). Several people and devices sharing AI accounts need centrally
  enforced account-contribution percentages and per-member caps, which device-local pools cannot agree on. Direction:
  an opt-in Shared pools section in AI Accounts backed by a small headless pool service that owns membership,
  credentials and one accounting ledger, reusing a gateway (New API, sub2api) only where it passes a compatibility
  spike, with each provider's redistribution permission checked first.
