# dshfiles

A personal [DeepSeek Harness](https://dshmarket.com) (DSH) setup: adopted
marketplace plugins, DSH-specific bundles, and the local toolchain that builds
and verifies them. We adopt a maintained plugin when it covers the need; we own
capabilities where the DSH APIs or product workflow need a focused extension.

## What it includes

### Owned DSH bundles

Every bundle directory under `plugins/@dshfiles/` is listed here; shared libraries are in the next table.

| Package | Capability |
|---|---|
| [`activity-timeline`](plugins/@dshfiles/activity-timeline/README.md) | One chronological timeline of agent, session, communication and jj workspace activity. |
| [`agent-communication`](plugins/@dshfiles/agent-communication/README.md) | Durable topic and direct messages between independent Agents. |
| [`agent-questions`](plugins/@dshfiles/agent-questions/README.md) | Parent-scoped questions, deferred answers, and revisioned Markdown feedback. |
| [`ai-accounts`](plugins/@dshfiles/ai-accounts/README.md) | Per-account Codex, Claude, OpenCode Go and Command Code providers, plus Cursor quota. |
| [`command-palette`](plugins/@dshfiles/command-palette/README.md) | App-wide searchable command palette and action registry. |
| [`diff-viewed`](plugins/@dshfiles/diff-viewed/README.md) | Track changed files reviewed per turn. |
| [`editor`](plugins/@dshfiles/editor/README.md) | Monaco file tree, tabs, open-from-anywhere, and confined saves. |
| [`goal-stall-guard`](plugins/@dshfiles/goal-stall-guard/README.md) | Pause goals whose rounds stop making progress. |
| [`jj-integration`](plugins/@dshfiles/jj-integration/README.md) | One jj workspace per thread, chosen before the first message, and a Land button that rebases its work onto `main`. |
| [`jujutsu`](plugins/@dshfiles/jujutsu/README.md) | Browse revision graph and run confirmed Source Control actions. |
| [`mcp-servers`](plugins/@dshfiles/mcp-servers/README.md) | Configure profile-wide MCP servers through native DSH clients. |
| [`model-effort-picker`](plugins/@dshfiles/model-effort-picker/README.md) | Search provider-grouped model catalogs and tune reasoning effort in the composer. |
| [`multi-host`](plugins/@dshfiles/multi-host/README.md) | Manage execution machines and runtimes through shared Host APIs. |
| [`optmem`](plugins/@dshfiles/optmem/README.md) | Persistent project memory, tools, and compact context views. |
| [`plugin-marketplace`](plugins/@dshfiles/plugin-marketplace/README.md) | Find and install plugins from the Framework Hub catalog. |
| [`project-checks`](plugins/@dshfiles/project-checks/README.md) | Run trusted project actions and inspect completion receipts. |
| [`prompt-stash`](plugins/@dshfiles/prompt-stash/README.md) | Save reusable prompts and bounded composer drafts locally. |
| [`queue-reorder`](plugins/@dshfiles/queue-reorder/README.md) | Reorder queued messages through DSH's durable inbox splice. |
| [`request-messages`](plugins/@dshfiles/request-messages/README.md) | Dispatch `agent/request-messages` on stock DSH so plugins can replace a request's messages. |
| [`secret-catalog`](plugins/@dshfiles/secret-catalog/README.md) | Browse project-scoped secret aliases without exposing values to Client. |
| [`settings-search`](plugins/@dshfiles/settings-search/README.md) | Search Settings fields and edit matches in place. |
| [`shared-runtime`](plugins/@dshfiles/shared-runtime/package.json) | One shared copy of third-party Client modules and the plugin stylesheet for `@dshfiles` UI plugins. |
| [`shortcuts`](plugins/@dshfiles/shortcuts/README.md) | Claim keyboard shortcuts before browser defaults. |
| [`sidebar-commands`](plugins/@dshfiles/sidebar-commands/README.md) | Use `/goto` to open a sidebar panel or recent session. |
| [`thread-sidebar`](plugins/@dshfiles/thread-sidebar/README.md) | Group project threads and customize DSH navigation. |
| [`workbench`](plugins/@dshfiles/workbench/README.md) | Persisted docking workbench for registered panels. |
| [`workspace-folder-picker`](plugins/@dshfiles/workspace-folder-picker/README.md) | Open Add Workspace directly in a Host-backed folder browser. |

### Shared libraries

| Package | Capability |
|---|---|
| [`plugin-ui`](plugins/@dshfiles/plugin-ui/README.md) | Shared UI components and Query, Table, Form, Machine, Chart, and Diff bindings. |
| [`project-folder-picker`](plugins/@dshfiles/project-folder-picker/README.md) | Reusable picker for registered projects and Host folders. |
| [`optmem-core`](plugins/@dshfiles/optmem-core/README.md) | Harness-agnostic append-only memory engine and tree model. |
| [`optmem-sqlite`](plugins/@dshfiles/optmem-sqlite/README.md) | SQLite storage and FTS5 search for OptMem. |

Bundles are Cordis packages with a `cordis.patch.yml`. Shared libraries are
imported by bundles and are not installed on their own.

### Web profile

The checked-in web profile lives in `profiles/web/` and contains the package
manifest ([installed composition](profiles/web/package.json)), Cordis patch, pnpm workspace policy, and portable AI-account metadata
(`ai-accounts.json`). Nixfiles seeds writable runtime copies, reconciles managed
plugin declarations, and copies account metadata only when the runtime account
store is absent. Credentials, provider auth, lockfiles, sessions, and other
runtime state stay local and are not copied.

### Toolchain

`tooling/dshx` is the locally owned `@dshfiles/dshx` fork for DSH 0.2, the
only vendored toolchain in the repository. It provides plugin scaffolding, build and profile checks, runtime inspection, and
the CLI used by owned plugins. See [`tooling/dshx/FORK.md`](tooling/dshx/FORK.md)
for provenance and the [authoring guide](tooling/dshx/docs/sdk/getting-started.md).

## Documentation

- [`AGENTS.md`](AGENTS.md): project boundaries, safe profile workflow, and development rules.
- [`docs/README.md`](docs/README.md): maintained repository-level documentation index.
- [`docs/profile-installs.md`](docs/profile-installs.md): profile install and composition behavior.
- [`plans/README.md`](plans/README.md): active investigations and implementation plans.
- [`tooling/dshx/docs/index.md`](tooling/dshx/docs/index.md): dshx authoring, CLI, and compatibility documentation.

Plugin guides live beside their packages and are all linked in the package index above.

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
