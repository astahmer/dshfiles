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

| Plan                                                                 | Open work                                                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Agent session history](agent-session-history.md)                    | Bounded, permission-scoped Session search and read tools for Agents; [tracker](agent-session-history/README.md). Not started on stock DSH: its route went through a core fork, and `dshx_comm_history` covers live descendants only. |
| [Agent session observability](agent-session-observability/README.md) | Wider history access, JJ change associations, orchestration writes, a scratch check.                                                                                                                                                 |
| [Async Agent questions](async-agent-questions.md)                    | Cross-thread inbox Host gap, root timed acceptance, real-provider child run, element anchors.                                                                                                                                        |
| [fff search](fff-search/README.md)                                   | Benchmarked fff against built-in search; next: DSH-Agent run, larger corpus, then an owned `fff-search` plugin that replaces native `grep`/`glob`.                                                                                   |
| [Multi-host](multi-host/README.md)                                   | Target/service-owner choice, owner-side service and launch-token hardening, disposable Linux upgrade/rollback acceptance.                                                                                                            |
| [pulls.review-style thread review](pulls-review/README.md)           | Host API, review panel, command and palette action, scratch-DSH verification.                                                                                                                                                        |
| [Backlog](backlog/README.md)                                         | Agent triage, lifecycle signals from threads/revisions/PRs, `@b:` mentions and backlinks, rich bodies, Discord import.                                                                                                                 |
| [Desktop shell](desktop-shell/README.md)                             | Relaunch on Host exit, lifecycle test, signing, updates.                                                                                                                                                                             |
| [HextaUI blocks](hextaui-blocks.md)                                  | Port MIT components; rebuild Pro blocks as references: shared CodeBlock/StackTrace, edit cards, bash stack traces, then P2 polish.                                                                                                   |
| [Inline chat UI](inline-chat-ui.md)                                  | Shared tool-card kit, edit cards, tool-group summary, plan progress, live activity strip, turn summary; ported from AI Elements / prompt-kit, affectUI as reference.                                                                 |

## Testing, research and housekeeping

| Plan                                                               | Open work                                                                                                                                                                |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [Plugin E2E coverage](plugin-e2e-coverage.md)                      | Run journeys in CI, a fresh baseline, Host egress, catalog scaffolding.                                                                                                  |
| [E2E speed and work-skipping](e2e-speed/README.md)                 | Phase trace and composition cache landed; next a per-scenario result cache, boot reuse, the network-boundary measurement.                                                |
| [Host loop freezes](host-loop-freezes/README.md)                   | Measurement-gated fixes for the session-search Host stall: harness, L0 escape hatch, L1 coalescing, L2 warm index, L3 measured plugin tax, L4 off-loop engine.           |
| [Slot assembly crash safety](slot-assembly-crash-safety/README.md) | A recomposition gap in the sole `root` slot owner blanks the Web UI (`SlotAssemblyError`): ship a shadowed fallback entry, record the renderer/shell half as a Host gap. |
| [Guardrails](guardrails.md)                                        | Lint ratchets, ast-grep rules, knip, exact pins, a shared plugin tsconfig, XState and namespace-class refactors.                                                         |
| [Guardrails: refactors](guardrails-refactors.md)                   | Steps 10–12: Hono e2e fakes, the `no-export-bag` rule in emilint, XState and namespace classes per plugin.                                                               |
| [Host gaps](dsh-host-gaps.md)                                      | Behaviors our plugins cannot build until DSH exposes a capability. A standing list, not a task plan.                                                                     |
| [Reference feature additions](reference-feature-additions.md)      | Evidence-gated feature and adoption backlog from reference products.                                                                                                     |
| [Self-improvement](self-improve/README.md)                         | Open improvements mined from DSH Session history; the ledger dedups and reopens them. A standing backlog, not a task plan.                                               |
| [~/dev cleanup](dev-cleanup-audit.md)                              | 23 workspaces and repositories awaiting a keep/archive/remove decision.                                                                                                  |
