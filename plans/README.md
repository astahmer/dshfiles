# Active plans and investigations

Plans live here only while implementation or acceptance work remains. Shipped
behavior belongs in the owning package's README (see the
[package index](../README.md#owned-dsh-bundles)) or in the dshx docs.

## Product and plugin work

| Plan | Scope |
|---|---|
| [Agent communication observability](agent-communication-observability.md) | Operator report and inspector for `@dshfiles/agent-communication`; [tracker](agent-communication-observability/README.md). Real Agent use is still unverified. |
| [Agent session history](agent-session-history.md) | Bounded, permission-scoped Session search and read tools for Agents; [tracker](agent-session-history/README.md). |
| [Agent session observability](agent-session-observability/README.md) | Read-only cross-session visibility; workspace lookup landed, history access and all Session writes pending. |
| [Async Agent questions](async-agent-questions.md) | Native timed-question acceptance; the child-question flow waits on a Host reply lifecycle. |
| [Multi-host](multi-host/README.md) | Runtime federation architecture; [phase tracker](multi-host/implementation.md). UI and rollout phases are partial. |
| [OptMem remaining validation](optmem/README.md) | Quiet 100k-event benchmark and full acceptance gates. |
| [Thread destination Host chip](thread-destination-host/README.md) | Make the jj-integration destination bar host-aware through multi-host, on stock DSH. |
| [Desktop shell](desktop-shell/README.md) | Desktop app lifecycle, signing and distribution gates. |

## Testing and research

| Plan | Scope |
|---|---|
| [DSH end-to-end testing](dsh-e2e-testing.md) | Test architecture: static checks, boot smoke, behavior journeys. |
| [Exhaustive plugin E2E](plugin-e2e-coverage.md) | Feature catalogs and browser journeys for every owned package; [tracker](plugin-e2e-coverage/README.md). |
| [Host gaps](dsh-host-gaps.md) | Behaviors our plugins cannot build until DSH exposes a capability. |
| [Reference feature additions](reference-feature-additions.md) | Evidence-gated feature and adoption shortlist from reference products. |

## Index maintenance

When a plan's work lands, move its durable behavior and decisions into the
owning package docs, delete the plan, and update this table in the same
revision. Historical receipts in a plan are not fresh verification.
