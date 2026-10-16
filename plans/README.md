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

| Plan | Open work |
|---|---|
| [Agent session history](agent-session-history.md) | Bounded, permission-scoped Session search and read tools for Agents; [tracker](agent-session-history/README.md). Not started on stock DSH: its route went through a core fork, and `dshx_comm_history` covers live descendants only. |
| [Agent session observability](agent-session-observability/README.md) | Wider history access, JJ change associations, orchestration writes, a scratch check. |
| [Async Agent questions](async-agent-questions.md) | Cross-thread inbox Host gap, root timed acceptance, real-provider child run, element anchors. |
| [Multi-host](multi-host/README.md) | Target/service-owner choice, owner-side service and launch-token hardening, disposable Linux upgrade/rollback acceptance. |
| [pulls.review-style thread review](pulls-review/README.md) | Host API, review panel, command and palette action, scratch-DSH verification. |
| [Desktop shell](desktop-shell/README.md) | Relaunch on Host exit, lifecycle test, signing, updates. |

## Testing, research and housekeeping

| Plan | Open work |
|---|---|
| [Plugin E2E coverage](plugin-e2e-coverage.md) | Run journeys in CI, a fresh baseline, Host egress, catalog scaffolding. |
| [Guardrails](guardrails.md) | Lint ratchets, ast-grep rules, knip, exact pins, a shared plugin tsconfig, XState and namespace-class refactors. |
| [Guardrails: refactors](guardrails-refactors.md) | Steps 10–12: Hono e2e fakes, the `no-export-bag` rule in emilint, XState and namespace classes per plugin. |
| [Host gaps](dsh-host-gaps.md) | Behaviors our plugins cannot build until DSH exposes a capability. A standing list, not a task plan. |
| [Reference feature additions](reference-feature-additions.md) | Evidence-gated feature and adoption backlog from reference products. |
| [~/dev cleanup](dev-cleanup-audit.md) | 23 workspaces and repositories awaiting a keep/archive/remove decision. |
