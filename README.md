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

| Package                                                                          | Capability                                                                                                                                                                    |
| -------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`activity-timeline`](plugins/@dshfiles/activity-timeline/README.md)             | One chronological timeline of agent, session, communication and jj workspace activity.                                                                                        |
| [`agent-communication`](plugins/@dshfiles/agent-communication/README.md)         | Durable topic and direct messages between independent Agents.                                                                                                                 |
| [`agent-plan`](plugins/@dshfiles/agent-plan/README.md) | Agent work you can read at a glance: `todo_write` as a plan card with step N of M and per-step timing, the current step pinned above the composer, a live strip of running tools, jobs and subagents, and Retry / Ask to fix on failed turns. |
| [`agent-preset`](plugins/@dshfiles/agent-preset/README.md)                       | Owned native preset surfaces with client-local Session draft selection.                                                                                                       |
| [`agent-questions`](plugins/@dshfiles/agent-questions/README.md)                 | Parent-scoped questions, deferred answers, and revisioned Markdown feedback.                                                                                                  |
| [`agent-telemetry`](plugins/@dshfiles/agent-telemetry/README.md)                 | OpenTelemetry GenAI spans for DSH turns, steps, model calls and tools, exported through dshx tracing; forked from @loongsuite/dsh-plugin.                                     |
| [`agent-toolkit`](plugins/@dshfiles/agent-toolkit/README.md)                     | An Agent toolkit page: the tools, plugins, MCP servers, skills and memory the agent can use in the current thread.                                                            |
| [`agents`](plugins/@dshfiles/agents/README.md)                                   | Persistent, mentionable agents: identity, instructions, model route and tool preset, dispatched into an ordinary thread.                                                      |
| [`agentsview`](plugins/@dshfiles/agentsview/README.md) | Browse, search and read the session logs of other local agent CLIs (Claude Code, Codex) inside DSH, read-only, with token totals per agent and model. |
| [`ai-accounts`](plugins/@dshfiles/ai-accounts/README.md)                         | Per-account Codex, Claude, OpenCode Go and Command Code providers, plus Cursor quota.                                                                                         |
| [`annotations`](plugins/@dshfiles/annotations/README.md)                         | Element-linked visual feedback: pick a UI element, get its source, and put a bounded note in the draft.                                                                       |
| [`apply-patch`](plugins/@dshfiles/apply-patch/README.md)                         | Agent tool that edits one file atomically after reading it, with whitespace-tolerant anchors.                                                                                 |
| [`attachment-gallery`](plugins/@dshfiles/attachment-gallery/README.md)           | Owned attachment presentation with keyboard-navigable image galleries.                                                                                                        |
| [`background-jobs`](plugins/@dshfiles/background-jobs/README.md)                 | Every background job of every Session on one page: live jobs from the job registry, finished ones from session logs, classified by what they do.                              |
| [`backlog`](plugins/@dshfiles/backlog/README.md)                                 | One capture feed for notes, tasks and agent work that organizes and ages itself.                                                                                              |
| [`backlog-jira`](plugins/@dshfiles/backlog-jira/README.md) | Jira Cloud projects as a Backlog sync provider: issues, workflow transitions, labels, priority, parents, issue links, due dates, ADF bodies and comments. |
| [`backlog-notion`](plugins/@dshfiles/backlog-notion/README.md) | Notion data sources as a Backlog sync provider: pages, status, tags, priority, parent, Markdown bodies and comments. |
| [`btw`](plugins/@dshfiles/btw/README.md)                                         | /btw opens a side chat about the current thread: a cache-friendly fork in a right-sidebar panel, archived on close.                                                           |
| [`capabilities-hub`](plugins/@dshfiles/capabilities-hub/README.md) | A Capabilities page: one launch point for agent skills, MCP servers and DSH plugins that opens each owner's own manager, with skills.sh link-out guidance and separate trust labels. |
| [`chat`](plugins/@dshfiles/chat/README.md)                                       | Owned fork of DSH's native Chat plugin that mounts only the transcript rows near the viewport.                                                                                |
| [`command-palette`](plugins/@dshfiles/command-palette/README.md)                 | App-wide searchable command palette and action registry.                                                                                                                      |
| [`component-gallery`](plugins/@dshfiles/component-gallery/README.md) | One page that shows every shared plugin-ui component, animated ones included, grouped in tabs. |
| [`context-compaction`](plugins/@dshfiles/context-compaction/README.md)           | Chunked compaction backend that keeps summary requests within the model context window.                                                                                       |
| [`dialogs`](plugins/@dshfiles/dialogs/README.md)                                 | The app's confirm, alert, prompt and select dialogs and its toasts, provided to every plugin through the dshx Dialogs and Toasts contracts.                                   |
| [`diff-viewed`](plugins/@dshfiles/diff-viewed/README.md)                         | Track changed files reviewed per turn.                                                                                                                                        |
| [`editor`](plugins/@dshfiles/editor/README.md)                                   | Monaco file tree, tabs, open-from-anywhere, and confined saves.                                                                                                               |
| [`fff-search`](plugins/@dshfiles/fff-search/README.md)                           | Agent `grep`/`glob` on a resident fff index instead of a ripgrep spawn per call.                                                                                              |
| [`frame-layout`](plugins/@dshfiles/frame-layout/README.md)                       | Owned fork of DSH's native layout package: the three-column AppFrame with browser-persisted panel widths.                                                                     |
| [`git-worktrees`](plugins/@dshfiles/git-worktrees/README.md) | Plain git repositories as a VCS provider: opt-in thread isolation in git worktrees, and file snapshots for undo. |
| [`goal-stall-guard`](plugins/@dshfiles/goal-stall-guard/README.md)               | Pause goals whose rounds stop making progress.                                                                                                                                |
| [`goal-tool`](plugins/@dshfiles/goal-tool/README.md)                             | Owned fork of DSH's goal tools that recognizes admitted answers to continued user-question forms.                                                                             |
| [`hmr-gate`](plugins/@dshfiles/hmr-gate/README.md)                               | Web client HMR transport that only announces a rebuilt plugin while its Host half is the code the running Host loaded.                                                        |
| [`html-render`](plugins/@dshfiles/html-render/README.md) | Agent tool `html_render`: a self-contained HTML page shown in the chat transcript as a sandboxed, themed card. |
| [`input-trigger`](plugins/@dshfiles/input-trigger/README.md)                     | Owned MIT fork of DSH's shared / and @ autocomplete engine with Codex-style @ token targeting.                                                                                |
| [`jj-integration`](plugins/@dshfiles/jj-integration/README.md)                   | One jj workspace per thread, chosen before the first message, and a Rebase button that moves its work onto `main`.                                                            |
| [`jujutsu`](plugins/@dshfiles/jujutsu/README.md)                                 | Browse revision graph and run confirmed Source Control actions.                                                                                                               |
| [`loopback-access`](plugins/@dshfiles/loopback-access/README.md)                 | Keep localhost access to the same authenticated DSH when its Web server binds a LAN interface.                                                                                |
| [`main-tabs`](plugins/@dshfiles/main-tabs/README.md)                             | Browser-like tabs above the main view for threads and global panels: pin, reorder, preview, shortcuts, per-project persistence.                                               |
| [`mcp-endpoint`](plugins/@dshfiles/mcp-endpoint/README.md) | An MCP server (streamable HTTP, bearer token) on the DSH web server, so Claude Code or Codex in a terminal can list, start, message, wait on and stop DSH threads. |
| [`mcp-servers`](plugins/@dshfiles/mcp-servers/README.md)                         | Configure profile-wide MCP servers through native DSH clients.                                                                                                                |
| [`memory`](plugins/@dshfiles/memory/README.md)                                   | Cross-thread memory from DSH's session logs: thread digests, a frozen start block, memory tools and a Memory panel. In the `web` profile.                                     |
| [`mentions`](plugins/@dshfiles/mentions/README.md)                               | One ranked @ menu for files and threads, with @thread: and @file: scopes, replacing the native reference source.                                                              |
| [`model-effort-picker`](plugins/@dshfiles/model-effort-picker/README.md)         | Search provider-grouped model catalogs and tune reasoning effort in the composer.                                                                                             |
| [`model-selection`](plugins/@dshfiles/model-selection/README.md)                 | Owned native model directory, composer seat and /model popup with local draft selection.                                                                                      |
| [`multi-host`](plugins/@dshfiles/multi-host/README.md)                           | Run new threads on other machines over SSH: host chip, hosts dialog, remote thread view.                                                                                      |
| [`plugin-guide`](plugins/@dshfiles/plugin-guide/README.md) | A developer Plugin Guide page: a static catalog of DSH public extension surfaces (dshx SDK entries, native slots, registries, contracts, Host APIs, shared modules) with scope, mode, replacement risk and source links, plus a read-only agent search tool. |
| [`policies`](plugins/@dshfiles/policies/README.md) | Binary deny rules layered on DSH permissions: a matching tool call is refused whatever the approval policy or sandbox mode says. |
| [`preview`](plugins/@dshfiles/preview/README.md) | Agent browser tools over a Host-managed headless Chromium scoped per thread, and the dev servers each thread started. |
| [`project-automations`](plugins/@dshfiles/project-automations/README.md) | Per-project automations: cron, daily, weekly or fixed-rate schedules and HMAC-signed webhooks that each start a new thread in a project with a templated prompt, agent preset and model, with a run history. |
| [`project-checks`](plugins/@dshfiles/project-checks/README.md)                   | Run trusted project actions and inspect completion receipts.                                                                                                                  |
| [`prompt-stash`](plugins/@dshfiles/prompt-stash/README.md)                       | Manage a shared library of reusable prompts and insert recent messages.                                                                                                       |
| [`pull-requests`](plugins/@dshfiles/pull-requests/README.md) | Link GitHub pull requests to DSH threads, watch status transitions, and settle terminal threads. |
| [`pulls-review`](plugins/@dshfiles/pulls-review/README.md)                       | Review this thread's changes in one scrollable diff, grouped and marked by pulls.review scopes.                                                                               |
| [`queue-reorder`](plugins/@dshfiles/queue-reorder/README.md)                     | Reorder queued messages through DSH's durable inbox splice.                                                                                                                   |
| [`references`](plugins/@dshfiles/references/README.md) | Named outside directories or git repositories attached to a session as read-only reference material. |
| [`request-messages`](plugins/@dshfiles/request-messages/README.md)               | Dispatch `agent/request-messages` on stock DSH so plugins can replace a request's messages.                                                                                   |
| [`resource-packs`](plugins/@dshfiles/resource-packs/README.md)                   | Typed property packs attached to referenced resources, shared by the GUI, plugins and agents.                                                                                 |
| [`rich-composer`](plugins/@dshfiles/rich-composer/README.md)                     | Owned fork of DSH's native Conversation plugin with structured session-reference paste.                                                                                       |
| [`secret-catalog`](plugins/@dshfiles/secret-catalog/README.md)                   | Browse project-scoped secret aliases without exposing values to Client.                                                                                                       |
| [`send-after-upload`](plugins/@dshfiles/send-after-upload/README.md)             | Queue the send when Enter or Send is pressed while an attachment is still uploading.                                                                                          |
| [`session-controller`](plugins/@dshfiles/session-controller/README.md)           | Owned fork of DSH's native Session controller that sends the browser only what it renders.                                                                                    |
| [`session-search`](plugins/@dshfiles/session-search/README.md)                   | Owns the sessionQuery search backend: an off-thread FTS5 index fed incrementally from session logs, so a content search is a pure read that never blocks the Host event loop. |
| [`session-undo`](plugins/@dshfiles/session-undo/README.md) | Undo and redo a thread's last turn: the conversation forks back before it and the workspace files return to their snapshot, through the VCS provider. |
| [`settings-models`](plugins/@dshfiles/settings-models/README.md) | Owned native Models settings page and onboarding dialogs that refresh once per burst and only while shown. |
| [`settings-shell`](plugins/@dshfiles/settings-shell/README.md)                   | VS Code-style Settings: a tab or dialog, every plugin's settings with real controls, inline search.                                                                           |
| [`settings-web-search`](plugins/@dshfiles/settings-web-search/README.md) | Owned native Web search settings page that reads its credential only while shown, once per burst. |
| [`shared-runtime`](plugins/@dshfiles/shared-runtime/package.json)                | One shared copy of third-party Client modules and the plugin stylesheet for `@dshfiles` UI plugins.                                                                           |
| [`shared-streams`](plugins/@dshfiles/shared-streams/README.md)                   | One EventSource per URL across tabs, so several DSH tabs never exhaust the browser's per-origin connections.                                                                  |
| [`shortcuts`](plugins/@dshfiles/shortcuts/README.md)                             | Claim keyboard shortcuts before browser defaults.                                                                                                                             |
| [`sidebar-right`](plugins/@dshfiles/sidebar-right/README.md)                     | Owned native sidebar-right fork: session-scoped resource bodies in workbench panels with unchanged contribution slots.                                                        |
| [`subprocess-local`](plugins/@dshfiles/subprocess-local/README.md)               | Owned fork of DSH's local subprocess service that stops polling long-lived process groups every 15 ms.                                                                        |
| [`test-runs`](plugins/@dshfiles/test-runs/README.md)                             | Vitest runs in the chat transcript as a test-results card: per-file results, assertion diffs, code frames, and Ask to fix.                                                    |
| [`thread-share`](plugins/@dshfiles/thread-share/README.md) | Share one DSH thread as a read-only live or snapshot page behind an unguessable link, optionally passphrase-protected, with expiry, revoke and view counts; plus a self-contained HTML export and an opt-in publish helper. |
| [`thread-sidebar`](plugins/@dshfiles/thread-sidebar/README.md)                   | Group project threads and customize DSH navigation.                                                                                                                           |
| [`thread-transfer`](plugins/@dshfiles/thread-transfer/README.md) | Export a thread to a portable `.dshthread` bundle (messages, tool calls, attachments, title, model) and import one as a new thread on another machine. |
| [`tool-ask-user`](plugins/@dshfiles/tool-ask-user/README.md) | Owned fork of DSH's `ask_user_question` tool whose description tells the model that questions are Markdown with sandboxed HTML previews. |
| [`tool-meta`](plugins/@dshfiles/tool-meta/README.md)                             | Start time and duration on every tool call in the chat transcript, counting live while the call runs.                                                                         |
| [`tool-search`](plugins/@dshfiles/tool-search/README.md)                         | Opt-in per-agent progressive discovery of native tools.                                                                                                                       |
| [`traces`](plugins/@dshfiles/traces/README.md)                                   | Local OTLP/HTTP trace receiver and viewer: trace list, span waterfall, operation stats and error groups inside DSH.                                                           |
| [`turn-summary`](plugins/@dshfiles/turn-summary/README.md)                       | A one-line summary under each finished turn: commands run and which failed, files edited, reads and searches. Every part can be switched off.                                 |
| [`tweet-context`](plugins/@dshfiles/tweet-context/README.md)                     | Agent tool for public X posts, photos, quotes, same-author threads, and content-aware video frames.                                                                           |
| [`ui-styles`](plugins/@dshfiles/ui-styles/package.json)                          | The one bundle that compiles and injects the shared plugin-ui Tailwind stylesheet, the ordered union of every owned plugin's classes.                                         |
| [`usage`](plugins/@dshfiles/usage/README.md)                                     | Inspect request-level model usage, costs, tokens, cache, timings and failures; in the `web` profile.                                                                          |
| [`user-questions`](plugins/@dshfiles/user-questions/README.md)                   | Owned fork of DSH's native question form: an answered question stays closed while its reply waits for admission.                                                              |
| [`web-fetch-readable`](plugins/@dshfiles/web-fetch-readable/README.md) | `web_fetch` provider for `ctx.web`: follows cross-origin redirects with per-hop public-address revalidation, accepts more text types and extracts the readable article. |
| [`web-search-brave`](plugins/@dshfiles/web-search-brave/README.md)               | Brave Web Search provider for ctx.web, with the key bound as a Secret Catalog reference.                                                                                      |
| [`whiteboard`](plugins/@dshfiles/whiteboard/README.md) | Per-project Excalidraw whiteboards stored on the Host, with agent tools to list, read, write and delete them, and machine → Mermaid diagrams. |
| [`workbench`](plugins/@dshfiles/workbench/README.md)                             | Persisted docking workbench for registered panels.                                                                                                                            |
| [`workspace-folder-picker`](plugins/@dshfiles/workspace-folder-picker/README.md) | Open Add Workspace directly in a Host-backed folder browser.                                                                                                                  |
| [`workspace-nav`](plugins/@dshfiles/workspace-nav/README.md)                     | Owned fork of DSH's native workspace picker: a New thread opens its composer before the Host creates the Session.                                                             |
| [`worktree-memory`](plugins/@dshfiles/worktree-memory/README.md)                 | Resident memory of DSH process trees by workspace and deterministic origins for current-user Node processes.                                                                  |
| [`whiteboard`](plugins/@dshfiles/whiteboard/README.md) | Per-project Excalidraw whiteboards stored on the Host, with agent tools to list, read, write and delete them, and machine → Mermaid diagrams. |

### Shared libraries

| Package                                                                      | Capability                                                                                                                                    |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| [`credential-port`](plugins/@dshfiles/credential-port/README.md)             | The Host service port a secrets catalog provides and credential consumers call, shared so neither plugin depends on the other.                |
| [`git-cli`](plugins/@dshfiles/git-cli/README.md) | The Effect service that runs the git CLI for Host plugins: bounded output, a timeout, non-interactive environment, credential-redacted stderr and one `git <verb>` span per run. |
| [`jev`](plugins/@dshfiles/jev/README.md) | The Effect service that asks TypeSafe's Jev one question over HttpClient, with the shared endpoint, request and answer schemas, a `jev classify` span and usage recording through `usage`. |
| [`jj-cli`](plugins/@dshfiles/jj-cli/README.md) | The Effect service that runs the Jujutsu CLI for Host plugins: one resolved executable, bounded output, timeouts, `jj <verb>` spans and an operation-head cache for view reads. |
| [`optmem-core`](plugins/@dshfiles/optmem-core/README.md)                     | Shared DSH-independent memory primitives used by `memory`, including redaction, UTF-8 handling and summary routing.                           |
| [`plugin-ui`](plugins/@dshfiles/plugin-ui/README.md)                         | Shared UI components and Query, Table, Form, Machine, Chart, and Diff bindings.                                                               |
| [`session-source-port`](plugins/@dshfiles/session-source-port/README.md)     | The Host port through which the Session controller accepts Sessions that run on another runtime, shared so neither side depends on the other. |
| [`sqlite-store`](plugins/@dshfiles/sqlite-store/README.md) | One Effect SqlClient layer for plugin-owned SQLite files: private modes, WAL pragmas, migrations that adopt a legacy `PRAGMA user_version`, and statement spans off by default. |
| [`vcs-provider-port`](plugins/@dshfiles/vcs-provider-port/README.md) | The Host port through which version-control plugins (jj, git worktrees) provide workspace isolation and file snapshots, shared so callers never depend on one provider. |
| [`vcs-provider-port`](plugins/@dshfiles/vcs-provider-port/README.md) | The Host port through which version-control plugins (jj, git worktrees) provide workspace isolation and file snapshots, shared so callers never depend on one provider. |

Bundles are Cordis packages with a `cordis.patch.yml`. Shared libraries are
imported by bundles and are not installed on their own.

### Web profile

The checked-in web profile lives in `profiles/web/` and contains the package
manifest ([installed composition](profiles/web/package.json)), Cordis patch, pnpm workspace policy, and portable AI-account metadata
(`ai-accounts.json`). Nixfiles seeds writable runtime copies, reconciles managed
plugin declarations, and copies account metadata only when the runtime account
store is absent. The profile includes [`usage`](plugins/@dshfiles/usage/README.md) for request-level
model analytics. Credentials, provider auth, lockfiles, sessions,
and other runtime state stay local and are not copied.

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
