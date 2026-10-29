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
| [fff search](fff-search/README.md)                                   | `fff-search` shipped (DSH grep ~10x faster per call); open: enable it in the `web` profile, larger-corpus and reasoning-model runs.                                                      |
| [Multi-host](multi-host/README.md)                                   | Plugin provisioning/SSH scratch E2E shipped; target/service owner, durable service, supervisor token boundary, and Linux release acceptance remain.                                      |
| [Host pool](host-pool/README.md)                                     | Resource-aware one-shot host selection and a shared resource view for the registered fleet.                                                                                              |
| [Verification evidence](verification-evidence.md)                    | Minimize peer metadata in Activity events; expose verification stage and regressions.                                                                                                    |
| [Remote threads as real threads](remote-thread-composer/README.md)   | A remote Session opening in this client's native chat and composer: mirror source, journal re-serve, prompt forwarding, per-session models, uploads.                                     |
| [pulls.review-style thread review](pulls-review/README.md)           | Host API, review panel, command and palette action, scratch-DSH verification.                                                                                                            |
| [Backlog](backlog/README.md)                                         | Agent triage, lifecycle signals from threads/revisions/PRs, `@b:` mentions and backlinks, rich bodies, Discord import.                                                                   |
| [Secret input binding](secret-input/README.md)                       | Bind a form input to a Secret Catalog alias (`secret:ALIAS`) instead of storing a value; backlog triage key first.                                                                       |
| [Desktop shell](desktop-shell/README.md)                             | Relaunch on Host exit, lifecycle test, signing, updates.                                                                                                                                 |
| [Workbench as the main view](workbench-main/README.md)               | Landed locally with green journeys; open: a Host restart and live confirmation on the `web` profile.                                                                                     |
| [DOM hook refactor](dom-hook-refactor.md)                            | Replace transcript/stat/frame/thread DOM mutations with typed owner-rendered extension points.                                                                                           |
| [HextaUI blocks](hextaui-blocks.md)                                  | Port MIT components; rebuild Pro blocks as references: shared CodeBlock/StackTrace, edit cards, bash stack traces, then P2 polish.                                                       |
| [Inline chat UI](inline-chat-ui.md)                                  | Shared tool-card kit, edit cards, tool-group summary, plan progress, live activity strip, turn summary; ported from AI Elements / prompt-kit, affectUI as reference.                     |

## Testing, research and housekeeping

| Plan                                                          | Open work                                                                                                                                                                                                                   |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Plugin E2E coverage](plugin-e2e-coverage.md)                 | Run journeys in CI, a fresh baseline, Host egress, catalog scaffolding.                                                                                                                                                     |
| [E2E speed and work-skipping](e2e-speed/README.md)            | Phase trace and composition cache landed; next a per-scenario result cache, boot reuse, the network-boundary measurement.                                                                                                   |
| [HMR compatibility gate](hmr-compat-gate/README.md)           | The `hmr-gate` transport and slot-inject containment shipped; open: the scratch loaded-vs-disk run, retry/reload actions on the notice, and a live client-only rebuild.                                                     |
| [Host loop freezes](host-loop-freezes/README.md)              | The replay harness (`bench:freezes`) and the L4 off-loop backend (`@dshfiles/session-search`, loaded in `web`) shipped, though the plan's status line still says proposed; confirm L1–L3 against the gates, then retire it. |
| [Host gaps](dsh-host-gaps.md)                                 | Behaviors our plugins cannot build until DSH exposes a capability. A decision register (own / upstream / drop), not a task plan.                                                                                            |
| [Reference feature additions](reference-feature-additions.md) | Evidence-gated feature and adoption backlog from reference products.                                                                                                                                                        |
| [Self-improvement](self-improve/README.md)                    | Open improvements mined from DSH Session history (jj hardening, fetch provider, checkout-sync fan-out, store folds, context diet); the ledger dedups and reopens them. A standing backlog, not a task plan.                 |
| [~/dev cleanup](dev-cleanup-audit.md)                         | 23 workspaces and repositories awaiting a keep/archive/remove decision.                                                                                                                                                     |

## Proposed, not started

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
