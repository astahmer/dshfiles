# DSH work consolidated on 2026-10-07

This note records the effective DSH work on the unified history. The
[README](../README.md) is the short feature catalog; component plans and plugin
READMEs hold implementation detail.

## Integrated capabilities

### DSHX and plugin development

The local `@dshfiles/dshx` fork owns DSH 0.2-compatible scaffolding, build and
profile checks, runtime inspection, scoped host/runtime commands, and a
Citty-based CLI. The history also includes the Chokidar project watcher,
validated Unix JSON-line bridge transport, runtime bundle dependency checks,
and isolated boot verification. See [`tooling/dshx/FORK.md`](../tooling/dshx/FORK.md)
and the [framework plan](../plans/dshx-plugin-framework.md).

### Sessions and Agent workflows

Core runtime work binds provider runtime identity to Sessions, migrates session
persistence formats, and records recoverable prompt attention. Focused crash
checks cover both the Session-log-first and attention-sidecar-first orders;
uncertain provider work is not replayed automatically. The Agent Questions
bundle provides durable parent/child questions, deferred outcomes, and
revisioned Markdown feedback with stale-target checks and receipts. The Cursor
adapter uses the same explicit recovery boundary for uncertain prompts.

### MultiHost and account continuity

The MultiHost bundle provides a directory of execution hosts and runtimes with
qualified native connectors. Its UI and CLI use the same Host APIs. AI Accounts
adds account-aware provider routing and durable quota-continuation state; only
known reset windows are scheduled, and unknown reset values stay unscheduled.

### DSH interface and productivity

The history includes the shared plugin UI and project-folder picker,
project-scoped Thread Sidebar, Settings search, sidebar commands, keyboard
shortcuts, viewed-file progress, durable queue reorder, prompt stash, Jujutsu
graph/actions, MCP server configuration, plugin marketplace, project checks,
and the Secret alias catalog. The full owned-plugin inventory is in the
[README](../README.md).

### Repository and profile setup

The value-free `.secret.json` alias map is retained; this repository does not
store secret values. The `web` and `probe` DSH profiles use a repository-local
link for `@dshfiles/multi-host` and include it in their bundle lists. Profile
install and composition checks passed with Node 22.23.3 and pnpm 12. The
isolated probe booted on port 3199. The live web instance on port 3080 was left
running and was not reloaded.

## Integration and preservation notes

The starting `main` revision was `450fdaef68af6e53eb38793ae5618387c5735a37`.
The current default source snapshot is
`4a8a6d94e494da4dee9d9983720a74afe9306a2b`, on the unified line after the
integration candidate. It includes the Session Controller sync script,
package/lock updates, and scratch verifier. Compared with the earlier default
snapshot `e706ef0d61208328522e1479ffbd7aea90b9639e`, this latest source tree
changes only `scripts/verify-core-runtime-scratch.mjs` and
`tooling/dsh-core/api-session-controller/package.json`; the latest full tree is
preserved before these docs.

Two preserved work-in-progress snapshots were reviewed and kept out of the
canonical line because their deltas are superseded by the later tested
implementation:

- `software-roadmap-resume@` at
  `69a2e31feee645bffa1b78fd58445d974a0b9b79` simplifies the child-stop test,
  removes the 20-item batch-boundary test, and labels a missing parent as a
  missing child. The current line retains the stronger recovery coverage and
  correct parent error. Three other source files already match the current
  implementation; the older snapshot remains pinned for recovery.
- The DSHX CLI draft at
  `32292280e6583b570591ff9946e420289d24c952` allows slot/provider/order flags
  on `add panel` and `add api`. The current CLI contract and tests deliberately
  limit those flags to `add ui`; the draft remains pinned rather than widening
  the contract.

No real-provider, public Host activation, or production result is inferred from
the isolated profile checks. See the [software additions
roadmap](../plans/software-additions-roadmap.md) for the current evidence gates.
