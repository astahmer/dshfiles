# dshfiles

A personal [DeepSeek Harness](https://dshmarket.com) (DSH) setup: adopted
marketplace plugins, DSH-specific bundles, and the local toolchain that builds
and verifies them. We adopt a maintained plugin when it covers the need; we own
capabilities where the DSH APIs or product workflow need a focused extension.

> **DSH broken?** Run `dsh-lkg` and open <http://127.0.0.1:3099>: the last known
> good DSH, with your accounts and threads. Then follow
> [Recovering a broken DSH](docs/recovery.md). Upgrade DSH only through
> `scripts/dsh-lkg/cli.mjs upgrade`.

## What it includes

### Owned DSH bundles

Every bundle directory under `plugins/@dshfiles/` is listed here; shared libraries are in the next table.

| Package                                                                          | Capability                                                                                                                                |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| [`activity-timeline`](plugins/@dshfiles/activity-timeline/README.md)             | One chronological timeline of agent, session, communication and jj workspace activity.                                                    |
| [`agent-communication`](plugins/@dshfiles/agent-communication/README.md)         | Durable topic and direct messages between independent Agents.                                                                             |
| [`agent-questions`](plugins/@dshfiles/agent-questions/README.md)                 | Parent-scoped questions, deferred answers, and revisioned Markdown feedback.                                                              |
| [`ai-accounts`](plugins/@dshfiles/ai-accounts/README.md)                         | Per-account Codex, Claude, OpenCode Go and Command Code providers, plus Cursor quota.                                                     |
| [`command-palette`](plugins/@dshfiles/command-palette/README.md)                 | App-wide searchable command palette and action registry.                                                                                  |
| [`diff-viewed`](plugins/@dshfiles/diff-viewed/README.md)                         | Track changed files reviewed per turn.                                                                                                    |
| [`editor`](plugins/@dshfiles/editor/README.md)                                   | Monaco file tree, tabs, open-from-anywhere, and confined saves.                                                                           |
| [`fff-search`](plugins/@dshfiles/fff-search/README.md)                           | Agent `grep`/`glob` on a resident fff index instead of a ripgrep spawn per call.                                                          |
| [`goal-stall-guard`](plugins/@dshfiles/goal-stall-guard/README.md)               | Pause goals whose rounds stop making progress.                                                                                            |
| [`home`](plugins/@dshfiles/home/README.md)                                       | New thread screen: own mark and headline, recent threads and work to rebase, and a Settings › New thread page.                            |
| [`jj-integration`](plugins/@dshfiles/jj-integration/README.md)                   | One jj workspace per thread, chosen before the first message, and a Rebase button that moves its work onto `main`.                        |
| [`jujutsu`](plugins/@dshfiles/jujutsu/README.md)                                 | Browse revision graph and run confirmed Source Control actions.                                                                           |
| [`mcp-servers`](plugins/@dshfiles/mcp-servers/README.md)                         | Configure profile-wide MCP servers through native DSH clients.                                                                            |
| [`model-effort-picker`](plugins/@dshfiles/model-effort-picker/README.md)         | Search provider-grouped model catalogs and tune reasoning effort in the composer.                                                         |
| [`memory`](plugins/@dshfiles/memory/README.md)                                   | Cross-thread memory from DSH's session logs: thread digests, a frozen start block, memory tools and a Memory panel. In the `web` profile. |
| [`multi-host`](plugins/@dshfiles/multi-host/README.md)                           | Run new threads on other machines over SSH: host chip, hosts dialog, remote thread view.                                                  |
| [`plugin-marketplace`](plugins/@dshfiles/plugin-marketplace/README.md)           | Find and install plugins from the Framework Hub catalog.                                                                                  |
| [`project-checks`](plugins/@dshfiles/project-checks/README.md)                   | Run trusted project actions and inspect completion receipts.                                                                              |
| [`prompt-stash`](plugins/@dshfiles/prompt-stash/README.md)                       | Manage a shared library of reusable prompts and insert recent messages.                                                                   |
| [`queue-reorder`](plugins/@dshfiles/queue-reorder/README.md)                     | Reorder queued messages through DSH's durable inbox splice.                                                                               |
| [`request-messages`](plugins/@dshfiles/request-messages/README.md)               | Dispatch `agent/request-messages` on stock DSH so plugins can replace a request's messages.                                               |
| [`secret-catalog`](plugins/@dshfiles/secret-catalog/README.md)                   | Browse project-scoped secret aliases without exposing values to Client.                                                                   |
| [`settings-shell`](plugins/@dshfiles/settings-shell/README.md)                   | VS Code-style Settings: a tab or dialog, every plugin's settings with real controls, inline search.                                       |
| [`shared-runtime`](plugins/@dshfiles/shared-runtime/package.json)                | One shared copy of third-party Client modules and the plugin stylesheet for `@dshfiles` UI plugins.                                       |
| [`shared-streams`](plugins/@dshfiles/shared-streams/README.md)                   | One EventSource per URL across tabs, so several DSH tabs never exhaust the browser's per-origin connections.                              |
| [`shortcuts`](plugins/@dshfiles/shortcuts/README.md)                             | Claim keyboard shortcuts before browser defaults.                                                                                         |
| [`sidebar-commands`](plugins/@dshfiles/sidebar-commands/README.md)               | Use `/goto` to open a sidebar panel or recent session.                                                                                    |
| [`thread-sidebar`](plugins/@dshfiles/thread-sidebar/README.md)                   | Group project threads and customize DSH navigation.                                                                                       |
| [`usage`](plugins/@dshfiles/usage/README.md)                                     | Inspect request-level model usage, costs, tokens, cache, timings and failures; in the `web` profile.                                      |
| [`workbench`](plugins/@dshfiles/workbench/README.md)                             | Persisted docking workbench for registered panels.                                                                                        |
| [`workspace-folder-picker`](plugins/@dshfiles/workspace-folder-picker/README.md) | Open Add Workspace directly in a Host-backed folder browser.                                                                              |

### Shared libraries

| Package                                                                      | Capability                                                                                                          |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`plugin-ui`](plugins/@dshfiles/plugin-ui/README.md)                         | Shared UI components and Query, Table, Form, Machine, Chart, and Diff bindings.                                     |
| [`project-folder-picker`](plugins/@dshfiles/project-folder-picker/README.md) | Reusable picker for registered projects and Host folders.                                                           |
| [`optmem-core`](plugins/@dshfiles/optmem-core/README.md)                     | Shared DSH-independent memory primitives used by `memory`, including redaction, UTF-8 handling and summary routing. |

Bundles are Cordis packages with a `cordis.patch.yml`. Shared libraries are
imported by bundles and are not installed on their own.

### Web profile

The checked-in web profile lives in `profiles/web/` and contains the package
manifest ([installed composition](profiles/web/package.json)), Cordis patch, pnpm workspace policy, and portable AI-account metadata
(`ai-accounts.json`). Nixfiles seeds writable runtime copies, reconciles managed
plugin declarations, and copies account metadata only when the runtime account
store is absent. The profile includes [`usage`](plugins/@dshfiles/usage/README.md) for request-level
model analytics and pins upstream [`dsh-context@0.72.0`](https://github.com/bowenliang123/dsh-context)
(Apache-2.0) for Context Insights; review compatibility and external requests in
scratch before changing the pin. Credentials, provider auth, lockfiles, sessions,
and other runtime state stay local and are not copied.

### Toolchain

`tooling/dshx` is the locally owned `@dshfiles/dshx` fork for DSH 0.2, the
only vendored toolchain in the repository. It provides plugin scaffolding, build and profile checks, runtime inspection, and
the CLI used by owned plugins. See [`tooling/dshx/FORK.md`](tooling/dshx/FORK.md)
for provenance and the [authoring guide](tooling/dshx/docs/sdk/getting-started.md).

### Desktop shell

[`apps/desktop`](apps/desktop/README.md) is an unsigned Electron window that
starts a DSH profile, shows its web UI, and stops the Host on quit
(`nix run .#desktop`).

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

`profile:sync` links owned bundles into a profile (reconciled from the seed,
for a profile seeded under `profiles/`). The live `web` profile follows its seed
on its own: the `dsh web` supervisor runs the same sync before every start and
restart, so seed and plugin changes need a restart, not `nixapply` (one last
`nixapply` installs that supervisor; see
[profile installs](docs/profile-installs.md#migrating-from-the-nix-copy)). `profile:boot` checks that
all composed entries activate. Try changes in the isolated `probe` profile
before promoting them to `web`; never restart the live web profile from a
validation run. See [`AGENTS.md`](AGENTS.md) for the full workflow and runtime
boundaries.
