# Repository documentation

This directory holds repository-wide operational guidance. Product and API documentation lives with its owning plugin or toolchain; active design work lives in [`plans/`](../plans/README.md).

| Document                                                     | Purpose                                                                                                                                  |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| [Recovering a broken DSH](recovery.md)                       | Start the last known good DSH, find what broke, refresh the snapshot, and upgrade DSH through the gate.                                  |
| [`profile-installs.md`](profile-installs.md)                 | Local profile installs, pnpm behavior, peer dependencies, and composition.                                                               |
| [`e2e-testing.md`](e2e-testing.md)                           | Test layers, boot smoke, Gherkin journeys, feature catalogs, and run evidence.                                                           |
| [Plugin screenshots](plugin-screenshots.md)                  | The screenshot each UI plugin ships, where captures live, the scratch-DSH capture, and the `check:screenshots` gate.                     |
| [`verification-evidence.md`](verification-evidence.md)       | Project Checks receipt ownership, safe Activity Timeline projection, Session navigation, and security evidence.                          |
| [`remote-project-checks.md`](remote-project-checks.md)       | Running trusted Project Checks on a peer host while the working copy stays local: executor policy, peer setup, failure codes and limits. |
| [Incremental checks](incremental-checks.md)                  | Unified pnpm workspace, Turbo caching, JJ-aware changed/related tests, and safe fallback boundaries.                                     |
| [Repository guardrails](guardrails.md)                       | Dependency and TypeScript contracts, lint ratchets, export ownership, Knip, client flows and HTTP fakes.                                 |
| [Client state ownership](client-state-ownership.md)          | Which plugin state belongs on the Host, which belongs to a browser window, and what to move next.                                        |
| [Community plugin audit](community-plugin-audit.md)          | Dated 308-entry audit, decision tables, first-party alternatives, and disposable-probe screenshots.                                      |
| [`scripts/README.md`](../scripts/README.md)                  | Repository-level scripts and their owning workflows.                                                                                     |
| [Agent tool parity](agent-tool-parity.md)                    | Every user-facing capability's agent tool, what is missing, and which gaps need a Host verb.                                             |
| [Native forks](native-forks.md)                              | Vendored native DSH packages, their pinned upstream and delta, and the drift/upgrade diff script.                                        |
| [Secret references](secret-references.md)                    | How a plugin stores `secret:ALIAS` instead of a value, resolves it on the Host, and offers the vault in a field.                         |
| [Performance](performance.md)                                | What made the live GUI slow, what fixed it, before/after numbers, and what is still open.                                                |
| [Repository checks](repository-checks.md)                    | Which check to run, `node --run` versus `pnpm run`, the e2e scope rule, and the Turbo cache/`--force` policy.                            |
| [Plugin reload](plugin-reload.md)                            | What a rebuilt bundle updates over HMR, what needs a Host restart, and how a failed reload behaves in the page.                          |
| [ADE interaction performance](ade-performance/README.md)     | Runtime audit, full-profile benchmarks, transcript prototype, architecture decision, and reversible roadmap.                             |
| [Self-improvement from Session history](self-improvement.md) | `/self-improve`: mining past Sessions into candidate signals, deterministic harness validation, and the improvement ledger.              |

For the complete package guide index, see the [repository README](../README.md#owned-dsh-bundles). For dshx, see the [toolchain documentation index](../tooling/dshx/docs/index.md).
