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

| Plan                                                                 | Open work                                                                                                                                                                                |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Agent session history](agent-session-history.md)                    | Bounded, permission-scoped Session search and read tools for Agents. Not started on stock DSH: its route went through a core fork, and `dshx_comm_history` covers live descendants only. |
| [Agent session observability](agent-session-observability/README.md) | Wider history access, JJ change associations, orchestration writes, a scratch check.                                                                                                     |
| [Async Agent questions](async-agent-questions.md)                    | Cross-thread inbox Host gap, root timed acceptance, real-provider child run, element anchors.                                                                                            |
| [fff search](fff-search/README.md)                                   | `fff-search` shipped (DSH grep ~10x faster per call) and is in the `web` profile; open: larger-corpus and reasoning-model runs.                                                          |
| [Multi-host](multi-host/README.md)                                   | Plugin provisioning/SSH scratch E2E shipped; target/service owner, durable service, supervisor token boundary, and Linux release acceptance remain.                                      |
| [Host pool](host-pool/README.md)                                     | Resource-aware one-shot host selection and a shared resource view for the registered fleet.                                                                                              |
| [Verification evidence](verification-evidence.md)                    | Minimize peer metadata in Activity events; expose verification stage and regressions.                                                                                                    |
| [Remote threads as real threads](remote-thread-composer/README.md)   | A remote Session opening in this client's native chat and composer: mirror source, journal re-serve, prompt forwarding, per-session models, uploads.                                     |
| [pulls.review-style thread review](pulls-review/README.md)           | Host API, review panel, command and palette action, scratch-DSH verification.                                                                                                            |
| [Backlog](backlog/README.md)                                         | Agent triage, lifecycle signals from threads/revisions/PRs, `@b:` mentions and backlinks, rich bodies, Discord import.                                                                   |
| [Secret input binding](secret-input/README.md)                       | Bind a form input to a Secret Catalog alias (`secret:ALIAS`) instead of storing a value; backlog triage key first.                                                                       |
| [DOM hook refactor](dom-hook-refactor.md)                            | Replace transcript/stat/frame/thread DOM mutations with typed owner-rendered extension points.                                                                                           |
| [HextaUI blocks](hextaui-blocks.md)                                  | Port MIT components; rebuild Pro blocks as references: shared CodeBlock/StackTrace, edit cards, bash stack traces, then P2 polish.                                                       |
| [Inline chat UI](inline-chat-ui.md)                                  | Shared tool-card kit, edit cards, tool-group summary, plan progress, live activity strip, turn summary; ported from AI Elements / prompt-kit, affectUI as reference.                     |
| [Typed chat drafts](typed-chat-drafts/README.md)                     | Activation only: the user picks a restart, then the New chat / typed-draft GUI check.                                                                                                    |
| [opencode v2 parity](opencode-parity.md)                             | Browser plugin context gaps against opencode v2 (composer, session screen, panel/tab model, registries); A14 unblocks the workbench and chat-focus migrations.                           |
| [t3code parity](t3code-parity.md)                                    | Gaps against t3code nightly: forge/PR plugin (C1, C2, B4), scheduled tasks and webhooks (B5), rewind any turn (B3), multi-model fan-out (A6), Host-owned settle (C3).                    |
| [Effect refactor](effect-refactor/README.md)                         | Move dshx and owned Host halves to Effect in waves: tracing bridge, tool-schema snapshot gate, pilot secret-catalog and jj-integration, then optional browser-side state.                |

## Testing, research and housekeeping

| Plan                                                           | Open work                                                                                                                                                                                                   |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Plugin E2E coverage](plugin-e2e-coverage.md)                  | Run journeys in CI, a fresh baseline, Host egress, catalog scaffolding.                                                                                                                                     |
| [E2E speed and work-skipping](e2e-speed/README.md)             | Phase trace and composition cache landed; next a per-scenario result cache, boot reuse, the network-boundary measurement.                                                                                   |
| [Host gaps](dsh-host-gaps.md)                                  | Behaviors our plugins cannot build until DSH exposes a capability. A decision register (own / upstream / drop), not a task plan.                                                                            |
| [Reference feature additions](reference-feature-additions.md)  | Evidence-gated feature and adoption backlog from reference products.                                                                                                                                        |
| [Self-improvement](self-improve/README.md)                     | Open improvements mined from DSH Session history (jj hardening, fetch provider, checkout-sync fan-out, store folds, context diet); the ledger dedups and reopens them. A standing backlog, not a task plan. |
| [~/dev cleanup](dev-cleanup-audit.md)                          | 23 workspaces and repositories awaiting a keep/archive/remove decision.                                                                                                                                     |
| [Performance optimization](performance-optimization/README.md) | Remaining client, Host and tooling work packages from the repository-wide audit, then full representative before/after acceptance.                                                                          |
| [Lint cleanup](lint-cleanup/README.md)                         | Remove the ratcheted lint baseline with real fixes and lower each cap as a rule empties.                                                                                                                    |

## Open follow-ups

Leftovers of finished plans. The plan files were deleted; each line links to the doc that now owns the topic.

- **HMR gate** ([design](../plugins/@dshfiles/hmr-gate/docs/design.md)): confirm in a scratch DSH with Host HMR enabled
  that `hmr/reload` releases a deferral, watch a client-only rebuild apply live, and decide whether the Plugins row
  gains retry and page-reload actions.
- **Host loop freezes** ([Host loop freezes](../plugins/@dshfiles/session-search/docs/host-loop-freezes.md)): measure
  the idle background tax of the activity timeline and usage store writes against the 5 ms/s gate; never measured.
- **Workbench main view** ([docking decisions](../plugins/@dshfiles/workbench/docs/docking-decisions.md#the-main-view)):
  the user restarts the `web` Host and confirms the Workbench centre live.

## Proposed, not started

Written plans for ideas that were scoped but not started:

- [Agent Calendar](agent-calendar.md): a turn-time Calendar tab inside Usage.
- [Capabilities hub](capabilities-hub.md): one launchpad for Skills, MCP and DSH plugin managers.
- [External usage history](external-usage-history.md): opt-in cross-harness token usage in Usage.
- [Plugin Guide](plugin-guide.md): a developer panel over a versioned catalog of public extension surfaces.
- [Session reminders](session-reminders.md): same-Session reminders through the official Schedule bundle.

Ideas that were investigated but never built. Their plan files were deleted; this line is what survives. Reopen one by
writing a new plan.

- **Slot assembly crash safety** (2026-10-19). A recomposition that briefly leaves the sole `root` slot owner
  (`frame-layout`) with zero registrations makes the stock renderer throw `SlotAssemblyError` past every error boundary
  and blanks the Web UI until a reload. Direction: register a shadowed fallback `root` entry that shows a recovery card,
  and record the renderer and shell half as a Host gap.
- **Shared account pool** (2026-10-22, research only). Several people and devices sharing AI accounts need centrally
  enforced account-contribution percentages and per-member caps, which device-local pools cannot agree on. Direction:
  an opt-in Shared pools section in AI Accounts backed by a small headless pool service that owns membership,
  credentials and one accounting ledger, reusing a gateway (New API, sub2api) only where it passes a compatibility
  spike, with each provider's redistribution permission checked first.
