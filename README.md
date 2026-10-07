# dshfiles

A personal [DeepSeek Harness](https://dshmarket.com) (DSH) setup: adopted
marketplace plugins, DSH-specific bundles, and the local toolchain that builds
and verifies them. We adopt a maintained plugin when it covers the need; we own
capabilities where the DSH APIs or product workflow need a focused extension.

## What it includes

### Owned DSH bundles

| Package | Capability |
|---|---|
| `agent-communication` | Durable topic and direct messages between independent Agents, quiet by default. |
| `agent-questions` | Parent-scoped questions, deferred answers, and revisioned Markdown feedback with durable receipts. |
| `ai-accounts` | Account-aware provider setup and model routing for supported providers. |
| `cursor-agent` | Cursor ACP sessions with explicit recovery for uncertain prompts. |
| `diff-viewed` | Mark changed files as viewed and track progress per turn. |
| `dsh-core-runtime` | Load local core runtime forks in a scratch profile for isolated verification. |
| `goal-stall-guard` | Pause goals whose rounds have stopped making progress. |
| `jujutsu` | Browse the revision graph and run confirmed Source Control actions. |
| `mcp-servers` | Configure profile-wide MCP servers through DSH's native MCP clients. |
| `multi-host` | Manage execution machines and runtimes through shared Host APIs, UI, and CLI. |
| `plugin-marketplace` | Find and install DSH plugins from the Framework Hub catalog. |
| `project-checks` | Run trusted project actions and inspect completion receipts and native hook results. |
| `prompt-stash` | Save reusable prompts and bounded composer drafts locally. |
| `queue-reorder` | Reorder queued messages through DSH's durable inbox splice. |
| `secret-catalog` | Browse project-scoped `secret` CLI aliases without sending values to the Client. |
| `settings-search` | Search Settings fields by label, section, and option, then edit them in place. |
| `shortcuts` | Claim keyboard shortcuts before the browser handles them. |
| `sidebar-commands` | Use `/goto` to open a sidebar panel or recent session. |
| `thread-sidebar` | Group project threads and customize DSH navigation. |

### Shared libraries

| Package | Capability |
|---|---|
| `plugin-ui` | Shared UI components and TanStack Query, Table, Form, and Charts bindings. |
| `project-folder-picker` | A reusable picker for registered projects and Host folders. |

Bundles are Cordis packages with a `cordis.patch.yml`. Libraries are imported by
bundles and are not installed on their own.

### Toolchain

`tooling/dshx` is the locally owned `@dshfiles/dshx` fork for DSH 0.2. It
provides plugin scaffolding, build and profile checks, runtime inspection, and
the CLI used by owned plugins. See [`tooling/dshx/FORK.md`](tooling/dshx/FORK.md)
for provenance and the [authoring guide](tooling/dshx/docs/sdk/getting-started.md).

## Documentation

- [Unification status and remaining work](docs/unification-status-2026-10-07.md): completion, blockers, recovery, and cleanup ledger.

- [`AGENTS.md`](AGENTS.md): project boundaries, safe profile workflow, and development rules.
- [`docs/profile-installs.md`](docs/profile-installs.md): profile install and composition behavior.
- [`docs/creator-mode.md`](docs/creator-mode.md): creator-mode availability and setup.
- [`plans/software-additions-roadmap.md`](plans/software-additions-roadmap.md): runtime and product roadmap with evidence gates.
- [`plans/async-agent-questions.md`](plans/async-agent-questions.md): durable Agent questions and Markdown feedback.
- [`plans/multi-host/implementation.md`](plans/multi-host/implementation.md): MultiHost design and implementation.
- [`plans/dshx-plugin-framework.md`](plans/dshx-plugin-framework.md): DSHX framework delivery and remaining Host gaps.
- [`plans/repo-hardening/README.md`](plans/repo-hardening/README.md): hardening work and validation records.

## Develop and verify

Use the Node version pinned by `.node-version` through fnm. DSH must run on the
official Node build; Nix's Node build is not compatible with its native loader.

```sh
pnpm install:all
pnpm check
pnpm profile:sync --profile probe
fnm exec --using="$(cat .node-version)" pnpm profile:boot --profile probe
```

`profile:sync` links owned bundles into a profile. `profile:boot` checks that
all composed entries activate. Try changes in the isolated `probe` profile
before promoting them to `web`; never restart the live web profile from a
validation run. See [`AGENTS.md`](AGENTS.md) for the full workflow and runtime
boundaries.
