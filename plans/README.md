# Active plans and investigations

Plans belong here while implementation or acceptance work remains. Stable product/API guidance belongs with its owning package: see the [complete plugin and library index](../README.md#owned-dsh-bundles). Completed work should move to that package's docs (or the owning toolchain docs), not stay as a second specification.

## Product and plugin work

| Plan | Scope |
|---|---|
| Agent Communication | [Implementation plan](agent-communication-observability.md); [acceptance tracker](agent-communication-observability/README.md). Remaining scratch/browser acceptance. |
| [Agent session history](agent-session-history.md) | Discovery and design proposal; no implementation claim. |
| [Async Agent questions](async-agent-questions.md) | Native/root acceptance and unresolved Host boundaries beyond the implemented plugin contract. |
| [AI Accounts: Claude and Cursor](claude-cursor-accounts.md) | Provider runtime and real-account acceptance gates. |
| [Command Palette](command-palette/README.md) | Remaining composed UI/style and profile acceptance. |
| [Queue attachment editing](queue-attachment-editing.md) | Proposed Host-level attachment-preserving edit; not established by the current workaround. |
| [Command Code route](own-commandcode-route.md) | Remaining provider route and third-party removal gates. |
| [Session handoff](session-handoff.md) | Open coordinator items without another owning plan (restart prerequisites, follow-ups). |
| [Plugin boot integrity](plugin-boot-integrity.md) | Cross-plugin profile composition and runtime acceptance. |

## Cross-plugin, toolchain, and product research

| Plan | Scope |
|---|---|
| ADE | [Roadmap](ade/README.md), [docking evidence](ade/docking.md), [editor notes](ade/editor.md), [performance baseline](ade/perf-baseline.md), [decisions](ade/decisions.md). Shipped behavior is in plugin guides. |
| DSH customization | [Product brief](dsh-customization/README.md), [integration review](dsh-customization/integration-review.md). Cross-plugin product scope. |
| [DSH end-to-end testing](dsh-e2e-testing.md) | Test architecture and coverage strategy. |
| [Host gaps](dsh-host-gaps.md) | Candidate native API gaps across owned plugins. |
| Exhaustive plugin E2E | [Plan](plugin-e2e-coverage.md), [implementation tracker](plugin-e2e-coverage/README.md). Catalog and browser-journey implementation; acceptance remains open. |
| Multi-host | [Architecture](multi-host/README.md), [phase tracker](multi-host/implementation.md); completed validation receipts live in the package docs. |
| [OptMem remaining validation](optmem/README.md) | One remaining benchmark gate; implementation docs are package-local. |
| [Reference feature additions](reference-feature-additions.md) | Evidence-gated feature and adoption shortlist. |
| [Repository hardening](repo-hardening/README.md) | Remaining repo/toolchain hardening tasks. |
| [Software additions roadmap](software-additions-roadmap.md) | Cross-product roadmap and release gates. |
| [Desktop shell](desktop-shell/README.md) | Desktop lifecycle and distribution gates. |

## Index maintenance

Keep this index limited to active plans. When a plan completes, migrate durable behavior, decisions, and evidence into the owning docs, update links, then remove the plan and its resume-only notes. Do not treat historical receipts as fresh verification.
