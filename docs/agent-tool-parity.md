# Agent tool parity

Every capability a human can reach in DSH should be reachable by an Agent through a
tool, the way BB gives plugins a capability API plus `registerTool`. This document
audits that parity across the owned plugins and the native DSH surfaces we run
(DSH `0.2.0-rc.2`, revision `thread-d91e67`), lists every missing tool with the
Host verb its implementation would call, and separates what a plugin can build
from what needs a Host verb first.

The rules that keep the list honest:

- **An agent tool** is either a dshx Host API method carrying a `tool:` binding
  (`method({ …, tool: { name, readOnly } })`), or a raw `ctx.tools.register`
  tool in a Host half. A service method without one is not callable by a model.
- **A host-gap** means no backing Host verb exists, so no plugin can build the
  tool without an upstream change. Those go to
  [`plans/dsh-host-gaps.md`](../plans/dsh-host-gaps.md), never faked client-side.
- **Write tools say so.** Every tool that changes state names the user request it
  requires ("call only when the user asked"), and destructive work (stopping a
  running thread) is never implied by a milder request.
- A capability that only exists as browser presentation state (a tab layout, a
  lightbox, a draft composer) is not agent-actionable; it is listed under
  *Presentation-only* rather than proposed as a tool.

## Coverage summary

Counts are from the audits below. "Missing" counts proposed tools with a real
backing verb; `host-gap` counts capabilities no verb can reach yet.

| Owner | Capabilities audited | Agent tools today | Missing tools | Host gaps |
| --- | --- | --- | --- | --- |
| thread-sidebar | 40 | 16 (new) | 12 | 4 |
| main-tabs | 8 | 0 | 2 | 2 |
| home | 4 | 0 | 3 | 0 |
| sidebar-commands | 2 | 0 | 1 | 0 |
| command-palette | 11 | 0 | 5 | 3 |
| mentions | 8 | 1 (`skill`) | 1 | 0 |
| btw | 8 | 0 | 3 | 1 |
| shortcuts | 4 | 0 | 2 | 1 |
| jj-integration | 22 | 8 | 5 | 3 |
| jujutsu | 28 | 11 | 0 | 3 |
| project-checks | 8 | 4 | 1 | 2 |
| project-folder-picker / workspace-folder-picker | 9 | 0 | 4 | 2 |
| workbench | 8 | 0 | 2 | 6 |
| agent-communication | 10 | 14 | 0 | 0 |
| agent-questions | 12 | 11 | 0 | 1 |
| activity-timeline | 7 | 5 | 0 | 0 |
| multi-host | 17 | 20 | 0 | 1 |
| goal-stall-guard | 4 | 3 | 1 | 0 |
| agent-toolkit | 9 | 1 | 6 | 3 |
| tool-meta | 3 | 0 | 2 | 1 |
| ai-accounts | 21 | 18 | 7 | 1 |
| model-effort-picker | 3 | 0 | 1 | 0 |
| usage | 5 | 2 (not installed) | 2 | 1 |
| memory | 12 | 11 | 1 | 0 |
| optmem | 6 | 7 (plugin not installed) | 3 | 0 |
| editor | 7 | 1 | 5 | 2 |
| diff-viewed | 3 | 0 | 1 | 2 |
| prompt-stash | 6 | 0 | 1 | 5 |
| queue-reorder | 7 | 2 (not installed) | 5 | 1 |
| request-messages | 1 | 0 | 0 | 1 |
| rich-composer | 2 | 0 | 0 | 2 |
| send-after-upload | 2 | 0 | 1 | 1 |
| attachment-gallery | 5 | 0 | 2 | 3 |
| Native session / workspace / model | 46 | 15 (partly) | 31 | 7 |
| Native platform / admin | 40 | 3 | 30 | 11 |
| settings-shell, plugin-marketplace, mcp-servers, secret-catalog, privacy-controls (+ `plugin-ui`, `shared-runtime`, `shared-streams`: no surface) | 52 | 15 (`secret_list`, `secret_get`, `mcp__*`, `settings_list`, `settings_set`, `settings_unset`, 9 `mcp_*`) | 19 | 5 |

## Missing tools

Each row is a tool worth building today: the backing verb already exists.

### thread-sidebar

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `thread_park` / `thread_unpark` | Park a thread out of the active groups | host-gap: nothing but browser-local `parkedSessionIds` (`src/settings.ts:110`) |
| `thread_mute` / `thread_unmute` | Snooze notifications 1h…forever | `settings/update`, namespace `thread-sidebar` (`src/settings.ts:111`) |
| `thread_mark_unread` | Mark a thread manually unread | host-gap: browser-local (`src/thread-notifications.ts:24`) |
| `thread_link` | Copy a thread id or link | host-gap for the Agent: `writeClipboard` is client-only (`src/thread-url.ts:14`) |
| `thread_settle_policy` | Per-thread auto-settle override | `settings/update`, `thread-sidebar` (`src/settings.ts:108-109`) |
| `thread_views_update` | Saved views add/rename/reorder/remove | `settings/update`, view presets |
| `thread_sidebar_settings_update` | Row display, attention groups, colours, subagent folding | `settings/update`, `thread-sidebar` (`src/settings.ts:10-21, 27-68, 123-126`) |
| `thread_auto_archive_settings` | Auto-archive idle threads, interval, exclusions | `settings/update`, `thread-sidebar` (`src/settings.ts:77-90`) |
| `thread_archive_rebased` | Archive rebased threads after a delay | `workspace/archiveSession` + jj `/threadAt` |
| `thread_children_list` | Child/subagent rows with fold state | `settings/update` + `session/list` |
| `remote_thread_list` | Threads on other hosts | `multi-host.threadList` (no `tool` binding) |
| `dsh_restart` | Restart DSH / copy launch URL | own `requestRestart` host service (`src/host.ts:18-28`) |

Already tool-served (this change): the 16 `thread_*` / `project_*` tools below.

### main-tabs

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `main_tabs_settings_update` | Tab strip settings (enabled, maxTabs, openMode, persistence) | `settings/update`, `dshfiles-main-tabs` (`src/settings.ts:6-23`) |
| `thread_attention_list` | Threads needing input / working / unread | partial: `session/list` + projections; approvals have no read verb |

### home

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `home_settings_update` | Brand mark, headline, new-thread settings | `settings/update`, `dshfiles-home` (`src/settings.ts:7-27`) |
| `thread_open` | Resume a recent project thread | client navigation only (`uiWorkspace.openSession`) |
| `thread_workspaces_list` | "Work to rebase" count | jj `repositories` + `layout.selectPanel` (client) |

### sidebar-commands

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `goto` | `/goto` panels and recent sessions | client only (`layout.selectPanel`, `uiWorkspace.openSession`) |

### command-palette

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `thread_search` | Search threads by title/project/path/id | `session/list` |
| `thread_content_search` | Search thread message content | `session/search` |
| `file_search` | Go-to-file over workspace files | `fileReferences.list` |
| `theme_set` | Light/dark/system | host-gap: client `ctx.theme` only |
| `workspace_open` | Open a workspace destination | client navigation only |

### mentions

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `mention_search` | One ranked `@` menu of files and threads | `fileReferences.list` + `sessionReferenceResolver/candidates` |

### btw

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `thread_side_question` | `/btw` side chat fork | `session/fork` + `rename` + `selectModel` + `prompt`; the plugin has no Host half today |
| `thread_archive` (reuse) | Closing the tab archives the fork | `workspace/archiveSession` |
| `thread_rename` (reuse) | Fork named `btw · <question>` | `session/rename` |

### shortcuts

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `sidebar_toggle` | Toggle the sidebar | host-gap: client layout service |
| `thread_create` (reuse) | New session chord | `session/create` |

### jj-integration

Bound now (sibling revision `feat(jj-integration): expose thread-workspace actions as agent tools`):
`jj_thread_projects`, `jj_thread_repositories`, `jj_thread_destination` and
`jj_thread_workspace_sync` read-only, plus `jj_thread_discard`, which requires an
explicit `force` so unlanded revisions are never abandoned by a bare request.

Deliberately not bound, because an existing tool already covers the decision or
there is no model decision to make: `land` and `threadAt` (both accept an
explicit path, and `jj_thread_rebase` / `jj_thread_status` already do),
`provision` (`jj_thread_isolate` covers the agent path), `noFolder` (a picker
selection), `classifyWorkspaces` (a client-picker helper).

Still missing:

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `jj_thread_archive_session` | Archive the Session behind a rebased thread | new API method over `WorkspaceController.archiveSession` |
| `jj_thread_preview` | Preview a thread's last messages | `SessionController.inspect` / history `page` |
| `jj_thread_sweep` | Sweep finished thread workspaces | existing internal `discardThread` |
| `jj_thread_register_folder` | Register a browsed folder as a project | `WorkspaceController.create` |
| `jj_thread_settings` | Read/write the plugin's settings scope | `settings.describe|update` on `dshfiles-jj-integration` |

### jujutsu

Bound now (sibling revision `feat(jujutsu): expose the revision graph and Source
Control as agent tools`), with eleven tools covering all 28 capabilities: the nine
read-only ones are `jj_register_repository`, `jj_load`, `jj_graph_page`,
`jj_graph_navigation`, `jj_revision_relationship`, `jj_graph_slice`, `jj_details`,
`jj_revision_files` and `jj_working_diff`.

The writes keep the product's two-step shape rather than one tool per action:
`jj_prepare_action` prepares one of the seventeen mutation kinds (describe, split,
squash, rebase, bookmark-move/set/delete, fetch, push, workspace-add, edit, new,
commit, duplicate, abandon, revert, restore) and returns its preview, and
`jj_confirm_action` applies a `previewId`. Both say to act only when the user
asked, so the plan a human would confirm in the UI is still shown first. Settings
are not separate tools: `settings_set` writes the `dshfiles-jujutsu` namespace.

### project-checks

Bound now (sibling revision `feat(project-checks): expose trusted actions and
receipts as agent tools`): read-only `project_checks_actions`,
`project_checks_receipts` and `project_checks_hook_events`, plus
`project_checks_run`. `sessionId` became optional so each tool defaults to the
calling thread, and a request that names neither a session nor an Agent caller is
refused.

Still missing: `project_checks_verify` is not a tool at all — verification fires
from the `agent/turn-stopping` hook, not from a user action.

### project-folder-picker / workspace-folder-picker

`workspace_browse_directory` (`directoryPicker.list`),
`workspace_create_directory` (`directoryPicker.createDirectory`),
`workspace_register_folder` and `workspace_add_folder`
(`WorkspaceController.create`). Both packages are client-only today, so these
need a Host half somewhere that owns them.

### workbench

`workbench_open_panel` and `workbench_settings` (`settings/update`,
`dshfiles-workbench`). Panel registry and layout live in browser state
(`globalThis.dshfilesWorkbenchPanelsV1`), so a Host-side tool cannot open a panel.

### agent-communication

Bound now (sibling revision `feat(activity-timeline,agent-communication): expose
retained reads as agent tools`): read-only `dshx_comm_browse` (`browseMessages`),
`dshx_comm_recipients` (`messageRecipients`) and `dshx_comm_diagnostics`
(`diagnostics`). Everything else is already tool-served, including the message
write verbs through the `dshx_comm_*` tools `host.ts` registers — binding
`postMessage`/`setSubscription`/`unsubscribe`/`acknowledge` on the API would only
duplicate them.

### activity-timeline

Bound now: `activity_timeline_event` — the event detail drawer (`activity-timeline.event`),
read-only. All five timeline reads now have tools.

### multi-host

Bound now (sibling revision `feat(multi-host): expose remote hosts and threads as
agent tools`): read-only `multi_host_identity`, `multi_host_status`,
`multi_host_ssh_hosts`, `multi_host_browse`, `multi_host_models`,
`multi_host_thread_transcript` and `multi_host_threads` (plus the existing
`multi_host_list`), and the writes `multi_host_save_ssh_host`,
`multi_host_remove_host`, `multi_host_remove_runtime`, `multi_host_reconnect`,
`multi_host_find_homes`, `multi_host_test`, `multi_host_mkdir`,
`multi_host_open_folder`, `multi_host_start_thread` and
`multi_host_forget_thread`. Every write names the user request it needs.

Deliberately untooled, pinned by a test:

| Verb | Why no tool |
| --- | --- |
| `runtimeCall` | Speaks native RPC on the remote Host; an Agent uses the specific verbs instead |
| `runtimePluginCall` | Reaches arbitrary allowlisted remote plugin methods — the same escape hatch |
| `runtimePing` | `multi_host_status` already reports connection state; ping is the chip menu's latency probe |
| `runtimeOpenView` / `runtimeCloseView` | Client presentation: a launch URL and its lease |
| `listDirectory` / `createDirectory` | The local runtime's own folder verbs; `multi_host_browse` / `multi_host_mkdir` cover the remote case |
| `runtimeUpsert` / `hostUpsert` | Registration steps `multi_host_save_ssh_host` already performs |
| `sessionCursor` | Internal polling cursor |

Replying to and stopping a remote thread now have dedicated methods
(`threadReply`, `threadStop`) and tools (`multi_host_thread_reply`,
`multi_host_thread_stop`), so no Agent needs the raw `runtimeCall` for them.

### agent-toolkit

`agent_toolkit_list` and `agent_toolkit_tools` (dshx registry `list`, `ctx.tools.schemas`),
`plugin_inventory_list` (`readPluginInventory`), `agent_toolkit_versions`,
`mcp_servers_list`, `skills_list`, `memory_start_block`, `memory_notes`.
`ctx.tools` records no registering owner, so the page's source/owner badges
cannot be reproduced exactly.

### tool-meta, goal-stall-guard

`host_settings_read` / `host_settings_write` for `tool-meta`'s namespace;
`goal_clear` is a *tool* gap — `goals/clear` exists but `update_goal` exposes no
clear action.

### ai-accounts

Bound now (sibling revision `feat(ai-accounts): expose account and quota control
as agent tools`): read-only `ai_accounts_identity`, `ai_accounts_catalog`,
`ai_accounts_history`, `ai_accounts_continuations`,
`ai_accounts_pricing_status`, `ai_accounts_native_providers` (plus the existing
`ai_accounts` and `ai_accounts_quota`), and the writes
`ai_accounts_refresh_quota`, `ai_accounts_collect_usage`,
`ai_accounts_set_distribution`, `ai_accounts_move_account`,
`ai_accounts_resume_continuation`, `ai_accounts_snooze_continuation`,
`ai_accounts_set_auto_retry`, `ai_accounts_set_native_provider` and
`ai_accounts_refresh_pricing`.

Still missing, because they write secrets or need a browser:

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `ai_accounts_save_profile` / `ai_accounts_update_profile` | Add or edit an account profile, route slug, model curation | `save` |
| `ai_accounts_remove_profile` | Remove an account profile | `remove` |
| `ai_accounts_import_secret` | Store an API key for an account from the Secret Catalog | `importSecretCatalogKey` + `credentials.set` (the plaintext must stay on the Host) |
| `ai_accounts_copilot_login` | GitHub Copilot device sign-in, cancel, sign-out | `beginCopilotLogin`/`cancelCopilotLogin`/`signOutCopilot` (sign-in needs a browser tab) |
| `ai_accounts_file_path` | The accounts file path | `filePath` |
| `ai_accounts_quote_routes` | Price the routes a Session used | `quoteRoutes` |
| `ai_accounts_set_history_schedule` | Usage-history interval and retention | `saveHistorySettings` |
| ~~`ai_accounts_get_settings` / `ai_accounts_set_settings` / `ai_accounts_set_failure_policy`~~ | Per-plugin settings | Retired: `settings_set` / `settings_unset` write the `ai-accounts` namespace |

### model-effort-picker, usage, memory, optmem

- `model-effort-picker`: `session_models` (`session/modelCatalog`); model
  *selection* is already served by `thread_select_model`.
- `usage`: `usage_status` (read-only) and `usage_reindex` are now bound, as are the
  existing `usage_requests` and `usage_report` — but the plugin is **not installed**
  in the web profile, so all four are latent until it is.
- `memory`: bound (sibling revision `feat(memory): expose note curation and
  memory inspection as agent tools`) — read-only `memory_projects`,
  `memory_start_block`, `memory_notes`, `memory_note_history`, `memory_threads`
  and `memory_citations`, plus `memory_edit_note` and `memory_forget_note`. Their
  panel types are now schemas (`panelNote`, `panelThread`, `notesFilter`,
  `memoryCitation`) with the public types derived from them. Left out on purpose:
  `memory_usage` (needs the full `MemoryUsage` schema), `memory_preview`
  (duplicates `memory_read` and would distort the memory-tool counters),
  `memory_rate_citation` (an Agent must not rate its own citations), and the
  settings pair, retired by `settings_set` / `settings_unset`.
- `optmem`: bound (not installed, so latent): `optmem_projects`,
  `optmem_project_for_path`, `optmem_project_view`, `optmem_project_zoom`,
  `optmem_project_search`, `optmem_context_preview` and `optmem_pipeline`. Its
  `overview`, `providers` and `backfill` methods are declared with TypeScript
  types only, so they need schemas before they can publish tool schemas; settings
  go through `settings_set`.

### editor, diff-viewed, queue-reorder, attachments, send-after-upload

- `editor`: **`editor_write` is bound** (sibling revision `feat(editor): expose
  the guarded save as an agent tool`) — the sha256-guarded save, with `sessionId`
  defaulting to the calling thread. Still missing: `open_workspace_path`
  (`session/openWorkspacePath`), `editor_set_open_file_links`,
  `editor_set_placement`; `editor_list_files` has no plugin API of its own
  (the core `workspaceFiles.list` verb, which an Agent reaches with glob/read);
  `editor_open_file` is a host-gap (no Host→Client channel opens a tab).
- `diff-viewed`: `changes_summary` (`api/changes.summary` fetch) — its per-file
  marks have no Host verb at all.
- `queue-reorder`: bound (not installed, so latent): `queue_describe` for the queued
  rows, plus the existing `queue_move`. Still missing: `queue_remove`,
  `queue_steer`, `queue_move_to_thread` and `queue_list_attachments` — those need
  the Session controller, which this plugin does not hold, so they belong in the
  plugin that does (`thread-sidebar`); `queue_reorder_set_preferences` is a
  settings write. `queue_edit` cannot preserve attachments because
  `QueueAction.edit` is text-only (a recorded Host gap).
- `attachment-gallery`: `session_attach_file` (session attachment + upload),
  `session_read_attachment` (`session/attachment`).
- `send-after-upload`: `session_queue_message` (queue-mode prompt).

### Native DSH session, workspace, model

Already covered by the new `thread_*` / `project_*` tools: session list, create,
fork, rename, cancel, archive/unarchive, pin/unpin, reorder, model selection,
workspace create/rename/delete/reorder.

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `session_search` | Search Session message content | `session/search` |
| `session_history` | Page a Session's history | `session/page`, `session/follow` |
| `session_watch` | Live control/projection stream | `session/control`, `session/projections` |
| `session_models` | Read the model catalog | `session/modelCatalog` |
| `session_prompt` | Send a prompt to another live root thread | `session/prompt` |
| `queue_update` | Edit/remove/steer a queued item | `session/updateQueue` |
| `session_attachment` | Read a Session image attachment | `session/attachment` |
| `open_path` | Open/reveal a path in its app | `session/openWorkspacePath` |
| `session_set_preset` / `agent_presets` | Pick or read an agent preset | `agentPresets/select`, `agentPresets/list`, `read` |
| `permission_catalog` / `permission_set` | Read or switch the Session permission preset | `permissionPresets/catalog`; the write path is the `/permission` command |
| `plan_state` / `enter_plan_mode` | Read or enter plan mode | `session/projections`; entering is command-only |
| `goal_clear` | Clear the goal | `goals/clear` |
| `message_feedback` / `session_feedback` | Rate a message, leave a Session remark | `messageFeedback/put|list|delete`, `sessionFeedback/record` |
| `run_command` / `list_commands` | Run or list slash commands | `commands/execute`, `commands/list` |
| `compact` | Compact the conversation | `commands/execute` → compaction seam |
| `reference_candidates` | `@` file/session candidates | `sessionReferenceResolver/candidates`, `fileReferences/list` |
| `workspace_changes` | Changed files, diff, bytes | `workspaceFiles/changes|list|read|readBytes|stat` |
| `session_stats` | Turn/step/timing stats | `session/projections` |
| `terminal_create` / `terminal_write` / `terminal_close` | Interactive terminal | `terminal/create|write|resize|rename|close|list` |

### Native platform and admin

| Proposed tool | Capability | Backing verb |
| --- | --- | --- |
| `settings_get` / `settings_set` | Read/write every registered settings namespace | `settings.describe|update|replace|mutate` |
| `open_settings_document` | Open the settings document in the host editor | `settings.openSettingsDocument` |
| `secret_set` / `secret_unset` | Set or clear a credential reference | `credentials.describe|set|unset` |
| `account_status` / `account_sign_in` | Account state, sign-in, balance | `account.getState|startSignIn|signOut|…` |
| `model_provider_list` | Providers and model discovery | `llm.listProviders|listConfigurableProviders|discoverModels` |
| `plugin_install` / `plugin_set_enabled` / `plugin_remove` | Manage bundles and entries | `pluginManager.installBundle|setPluginEnabled|removeBundle|…` |
| `plugin_inventory` | Runtime inventory (Loader entries, presets) | `pluginInventory.list` |
| `plugin_version_exemption` | Exact-version exemptions | `pluginManager.listVersionExemptions|setVersionExemption` |
| `attach_file` | Upload and attach a file to a Session | `fileUploads.upload`, `session.attachment` |
| `export_session_log` | Download the Session log | `/export` command, `SESSION_LOG_EXPORT_PATH` route |
| `submit_session_feedback` | Session-level feedback text | `sessionFeedback.record` |
| `pick_directory` / `create_directory` | Directory picker and folder creation | `directoryPicker.pick|list|createDirectory` |
| `convert_office_to_pdf` | Office → PDF preview | `officeToPdf.render|convert` |
| `open_in_app` | Open/reveal in a native application | `session.openWorkspacePath` + app catalog |

### settings-shell, plugin-marketplace, mcp-servers, secret-catalog, privacy-controls

`plugin-ui` (build-time component library, no runtime entry) and `shared-runtime`
(one shared module copy) expose nothing user-facing; `shared-streams` is a
plumbing shim whose only controls are the Loader row and a localStorage switch.
Every remaining capability here is writable through `settings.describe|update|mutate`
or the plugin's own Host API, so only the tool registration is missing.

Bound now (sibling revision `feat(settings-shell): expose settings read, merge and
reset as agent tools`): `settings_list` (read-only — every namespace with its
revision and secret-field count, or one namespace's redacted JSON value),
`settings_set` (merge a JSON patch) and `settings_unset` (reset one path). They
read the namespace revision in the same call, so a lost race is a readable
`settings-conflict`, and a read-only profile refuses before any write. That
retires the one-off `*_settings_update` proposals below: a namespace write is
now `settings_set` with that namespace, not a tool per plugin.

| Proposed tool | Owner | Backing verb |
| --- | --- | --- |
| `settings_document_path` / `settings_open_document` | settings-shell | `settings.openSettingsDocument`, `settings-shell.documentPath`, `session.openWorkspacePath` |
| `settings_shell_upstream` | settings-shell | `settings-shell.upstream` |
| `marketplace_search_plugins` | plugin-marketplace | `plugin-marketplace.list` |
| `marketplace_install_plugin` | plugin-marketplace | `plugin-marketplace.install` (writes the profile; keep explicit consent) |
| ~~`mcp_list_servers` / `mcp_refresh_servers`~~ | mcp-servers | Bound: `mcp-servers.list`, `mcp-servers.refresh` |
| ~~`mcp_search_registry`~~ | mcp-servers | Bound: `mcp-servers.searchRegistry` |
| ~~`mcp_save_server` / `mcp_remove_server`~~ | mcp-servers | Bound: `mcp-servers.save`, `mcp-servers.remove` |
| ~~`mcp_set_server_enabled` / `mcp_set_connection`~~ | mcp-servers | Bound: `mcp-servers.setEnabled`, `mcp-servers.setConnection` |
| `mcp_authorize_server` | mcp-servers | `mcp-servers.authorize` — deliberately unbound: it needs the browser origin for its redirect and a human consent step |
| ~~`mcp_sign_out_server`~~ | mcp-servers | Bound: `mcp-servers.signOut` |
| ~~`mcp_set_preferences`~~ | mcp-servers | Bound: `mcp-servers.setPreferences` |
| `privacy_controls_read` / `privacy_controls_set_feature` / `privacy_controls_set_all` | privacy-controls | `privacy-controls.read`, `setFeature`, `setAll` |
| `secret_copy` / `secret_create` | secret-catalog | `secret-catalog.copy`, `create` (a written plaintext must stay on the Host) |
| `secret_update` / `secret_remove_alias` / `secret_delete_item` | secret-catalog | `secret-catalog.update`, `removeAlias`, `deleteItem` (vault deletion is irreversible) |
| `secret_machine` | secret-catalog | `secret-catalog.machine` |
| `secret_import_credential` | secret-catalog | `secretCatalogCredentials.listKeys/importKey` + `credentials.set` |
| ~~`settings_update` (per-plugin namespaces)~~ | plugin-marketplace, secret-catalog, privacy-controls, ai-accounts, home, main-tabs, tool-meta, workbench | Retired: `settings_set` / `settings_unset` write any namespace (`dshx-plugin-marketplace`, `secret-catalog`, `ai-accounts`, `dshfiles-home`, `dshfiles-main-tabs`, `thread-sidebar`, …) |

Already callable here: `secret_list`, `secret_get`, and a connected server's own
`mcp__<serverName>__*` tools.

Client-only or verb-less in this group: the MCP `@`-mention and composer quick
panel (client input), the catalog's project-folder selection (picker verbs exist,
nothing persists the catalog's chosen folder), "Editor (in DSH)" for the Settings
document (`dshfiles:open-file` browser event only), connection reconnect and the
desktop-update indicator (client and Electron bridges), naming another machine in
secret-catalog, and `settings-shell`'s welcome-notice state in a remote browser.
Profile-level plugin install/remove exists in core `plugin_manager`
(`install_bundle` / `set_bundle` / `remove_bundle`) but its Loader row is
`disabled: true` in the live web profile, so it is not agent-callable here.

## Host gaps (no verb, so no tool today)

- **Thread park/unpark, manual unread, desktop notifications** (thread-sidebar):
  browser-local state, no park verb, no read-state verb, no notify verb.
- **Open Settings / open a panel / open a thread / open an editor tab**: no Host
  verb opens a UI surface; navigation and layout are client-only.
- **Right-sidebar tabs, left-sidebar grouping, tab strips, workbench docking**
  (workbench, main-tabs, thread-sidebar): client layout state.
- **Composer and draft state** (rich-composer `insertReference`, prompt-stash
  library and drafts, send-after-upload cancel banner, attachment draft retry):
  the composer is client-owned; no Host RPC writes into a user's draft.
- **Review marks** (diff-viewed, jujutsu, thread-sidebar read state): stored in
  `localStorage`, no Host projection.
- **Jujutsu revision filters** (author/date/mine/immutable) and `open-in-editor`:
  client-side filtering over a capped page, and a window event.
- **Approval answering** (native approval): deliberately has no RPC — an Agent
  must never answer its own approval request.
- **Permission preset write, plan-mode enter** (native): command-only paths, no
  dedicated verbs.
- **Session deletion** (native): no verb and no UI control; archive is the only
  removal path.
- **Attachment bytes, credential records, MCP core servers, multi-host core,
  desktop updates, product telemetry, skill enable/disable, session-log export**
  (native): no Remote verb on the installed contract.
- **Multi-host pending destination** (multi-host): the "run the next thread on
  host X" choice is a client stored value.
- **ai-accounts credential recovery panel, usage "open the request's thread"**:
  panel navigation and turn-scoped navigation have no verb.

## Presentation-only (no tool is possible or useful)

Panel chrome and visual state: activity-timeline and agent-communication panels,
agent-question card styling, tool-meta timing line, diff-viewed progress ring,
attachment lightbox/rail, workbench docking surfaces, main-tabs strip, home
branding, prompt-stash dialogs, request-messages (Host-only seam), optmem-core
and optmem-sqlite (engine and storage adapter), plugin-ui and shared-runtime
(libraries), shared-streams (connection sharing).

## Already covered today

Native: bash, fs (read/write/edit/glob/grep), web, todo, skill, present, jobs,
goal, ask-user, subagent (+control), workflow, cordis (read-only inspection),
memory write, plan exit.

Owned plugins: `dshx_comm_*` (11), agent-questions' question and feedback tools
(11), `activity_timeline_page|stats|attention|related`, `multi_host_list`,
`ai_accounts`, `ai_accounts_quota`, `memory_search|read|note`,
`secret_list|get`, `usage_requests|report` (not installed), `queue_move` (not
installed), optmem's four tools (not installed), `extend_goal_budget`,
`complete_blocked_goal`, `dshx_capabilities`, `agent-toolkit.versions`, and the
16 thread/project tools added here.

## Landed: thread and project tools

The sibling revision `feat(thread-sidebar): let an Agent drive thread and project
actions` makes `@dshfiles/thread-sidebar` serve a `thread-actions` dshx API
([`thread-actions-api.ts`](../plugins/@dshfiles/thread-sidebar/src/thread-actions-api.ts),
[`thread-actions.ts`](../plugins/@dshfiles/thread-sidebar/src/thread-actions.ts),
[`thread-actions-host.ts`](../plugins/@dshfiles/thread-sidebar/src/thread-actions-host.ts))
whose methods carry `tool:` bindings:

`thread_list`, `thread_archive`, `thread_unarchive`, `thread_pin`,
`thread_unpin`, `thread_rename`, `thread_fork`, `thread_create`, `thread_stop`,
`thread_select_model`, `project_list`, `project_register`, `project_rename`,
`project_delete`, `project_reorder`, `thread_move`.

Semantics worth knowing:

- Write methods take an optional `sessionId` and default to the **calling**
  thread, so a thread can rename, fork, pin, stop, re-model, archive or move
  itself.
- `thread_archive` never stops running work on its own. A running thread is
  refused with the active families (turn, job, subagent, schedule) named; only
  `stopActivity: true`, which the description ties to an explicit user request,
  stops that work first — the sidebar's own stop-and-archive confirmation.
- Every write tool's description ends with "call only when the user asked".
- These are Host-side tools: the running DSH keeps the old Host until the user
  restarts, so they appear only after a restart.

A second sibling revision, `feat(jj-integration): expose thread-workspace
actions as agent tools`, binds `jj_thread_projects`, `jj_thread_repositories`,
`jj_thread_destination`, `jj_thread_workspace_sync` (read-only) and
`jj_thread_discard` (explicit `force`) on the existing `jj-threads` API, so an
Agent can see and remove thread workspaces, not only isolate and rebase its own.

A third, `feat(settings-shell): expose settings read, merge and reset as agent
tools`, binds `settings_list` (read-only), `settings_set` and `settings_unset`
over the Host settings service, which covers every namespace — so the per-plugin
`*_settings_update` proposals are retired rather than built.

A fourth, `feat(ai-accounts): expose account and quota control as agent tools`,
binds sixteen account and quota verbs, including every read of live quota,
stored history, price cache, native provider rows and the quota-blocked
continuations an Agent can resume, snooze or arm for automatic retry. Account
profiles, credential import and the Copilot device flow stay untooled because
they write secrets or need a browser.

A fifth, `feat(multi-host): expose remote hosts and threads as agent tools`,
binds seventeen host and remote-thread verbs — host records, connection state and
reconnects, remote folder browsing and creation, remote model catalogs, starting
a thread on another machine, reading its transcript, listing this DSH's remote
threads and forgetting their local records. The raw native/plugin RPC escape
hatches stay untooled, and remote thread *reply* and *stop* wait for dedicated
methods.

A sixth, `feat(mcp-servers): expose MCP server management as agent tools`, binds
nine: the server list and registry search read-only, plus refresh, save,
enable/disable, connect/disconnect, remove, sign-out and the four manager
preferences. `authorize` stays untooled because its redirect needs the browser
origin and a human consent step.

A seventh, `feat(activity-timeline,agent-communication): expose retained reads as
agent tools`, closes both read-only gaps: `activity_timeline_event` and
`dshx_comm_browse` / `dshx_comm_recipients` / `dshx_comm_diagnostics`.

An eighth, `feat(project-checks): expose trusted actions and receipts as agent
tools`, binds the four project-check actions, receipts, hook events and the run
verb, defaulting the target to the calling thread.

A ninth, `feat(memory): expose note curation and memory inspection as agent
tools`, makes the memory panel types schemas and binds eight tools, so an Agent
can correct or forget a note the user asked about and inspect what memory holds.

A tenth, `feat(editor): expose the guarded save as an agent tool`, binds
`editor_write`: the one save in DSH that refuses to overwrite a file that changed
on disk since it was read. It is the deliberate exception to the "only when the
user asked" gate — saving a file *is* the task, so the sha256 guard, not a request
gate, is what protects it; `overwrite: true` stays reserved for a user who asked
to discard concurrent changes.

Then the sweep closed the rest of the P1 list: jujutsu's eleven tools over its
graph and Source Control actions (all 28 capabilities, writes still prepared and
confirmed); `usage_status`/`usage_reindex`; `queue_describe`;
optmem's seven explorer reads; and `multi_host_thread_reply` /
`multi_host_thread_stop` on two new dedicated methods.

One repo-health fix came out of the same pass: memory's two hand-written CSS rules
lived in the file that emits the shared Tailwind sheet, so its compiled sheet hashed
differently and the page loaded a second full Tailwind copy — the palette budget's
"plugins share one stylesheet" scenario was red for it, including on main. Moving
those rules to `memory-reference.css` made the sheet byte-identical again and the
scenario passes.

## Backlog

1. **P1 — bind tools to verbs that already exist.** Done for every owner except
   the ones with a reason to wait: `tool-meta` (its namespace is reached by
   `settings_set`), `queue-reorder`'s queue edits (need the Session controller, so
   they belong in `thread-sidebar`), and `optmem`'s `overview`/`providers`/
   `backfill` (need schemas; the plugin is not installed either). Bound so far:
   `thread-sidebar`, `jj-integration`, `settings-shell`, `ai-accounts`,
   `multi-host`, `mcp-servers`, `agent-communication`, `activity-timeline`,
   `project-checks`, `memory`, `editor`, `jujutsu`, `usage`, `queue-reorder`,
   `optmem`.
2. **P2 — install the plugins that already ship tools.** `usage`, `optmem`,
   `queue-reorder` are written but absent from the web profile, so their tools
   are dead code today; decide per plugin whether it belongs in the seed.
3. **P2 — remaining settings and admin tools.** `settings_list`/`settings_set`/
   `settings_unset` are done and retire the per-plugin namespace writes; still
   open are the marketplace install, the MCP server lifecycle and the settings
   document actions.
4. **P3 — new Host-side wrapping for client-only packages** (`btw`,
   `project-folder-picker`, `workspace-folder-picker`, `diff-viewed`): give the
   owning plugin a Host half, then bind the verbs.
5. **P3 — host-gap requests.** The union above is recorded in
   [`plans/dsh-host-gaps.md`](../plans/dsh-host-gaps.md), starting with thread
   park/unread state, an open-surface action, and a Session delete verb.
6. **Every change follows the parity rule in [`AGENTS.md`](../AGENTS.md):** a
   user-facing capability ships with its agent tool, or its host gap is recorded.
