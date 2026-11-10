# How OpenAI Codex models work that runs somewhere other than the local machine

Research for the DSH `multi-host` plugin: what Codex does for cloud tasks, remote
hosts, and remote environments, and what that implies for a chat/composer UI that
must serve local _and_ remote threads.

Codex is **not** checked out here. Everything below comes from primary sources
read over HTTP at a pinned commit:

- Repo: `openai/codex` @ `17a0e6f63fad13f577ef87b36b4ea37fc06385e9` (main, 2026-10-21),
  fetched as raw files from `raw.githubusercontent.com`.
- Product/protocol docs: `https://learn.chatgpt.com/docs/**` (the current home of
  `developers.openai.com/codex/**`; `developers.openai.com/codex/app-server`
  redirects to `learn.chatgpt.com/docs/app-server`).

Legend used throughout: **[V]** verified in a primary source (quoted/fetched, URL
given), **[I]** inference from that evidence, **[U]** unverified — could not
confirm from primary sources.

---

## 1. How "where the work runs" is modeled

There are **three distinct mechanisms**, not one. Mixing them up is the main
source of confusion when comparing Codex to `multi-host`.

### 1a. Local app-server, with the _environment_ as a first-class selector

An app-server process owns threads; each thread (and each turn) carries an
environment selection. `ThreadEnvironment` is `{ environmentId, cwd,
runtimeWorkspaceRoots }`, described as "An environment selected by a loaded
thread, independent of connection status." **[V]**
`codex-rs/app-server-protocol/src/protocol/v2/environment.rs`

`thread/start` and `turn/start` accept `environments: TurnEnvironmentParams[]`:

> "Optional sticky environments for this thread. Omitted selects the default
> environment when environment access is enabled. Empty disables environment
> access … Non-empty selects the first environment as the current turn
> environment."

**[V]** `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` (`ThreadStartParams`),
`.../v2/turn.rs` (`TurnEnvironmentParams { environment_id, cwd, runtime_workspace_roots }`,
and `TurnStartParams.environments`).

A remote environment is registered by the client, not discovered by the server:

```
environment/add { environmentId, execServerUrl, authBearerToken?, websocketRequestId?, connectTimeoutMs?, skills? }
environment/info { environmentId } -> { shell, cwd }
environment/status { environmentId } -> ready | pending | disconnected | unknown
```

**[V]** `codex-rs/app-server-protocol/src/protocol/v2/environment.rs`,
`codex-rs/app-server-protocol/src/protocol/common.rs` (methods are
`#[experimental("environment/add")]` …), and
`codex-rs/app-server/src/request_processors/environment_processor.rs`, which maps
the RPC onto `codex_exec_server::RemoteEnvironmentOptions { exec_server_url,
connect_timeout, http_headers /* Authorization: Bearer … */ }`.

**Key architectural point:** the remote side is an **executor**, not a second
agent host. `codex exec-server` exposes process + filesystem RPCs over JSON-RPC:

> "`codex-exec-server` is the library backing `codex exec-server`, a small JSON-RPC
> server for spawning and controlling subprocesses through `codex-utils-pty`."
> RPCs: `initialize` / `initialized`, `process/start|read|write|terminate`, and
> `fs/readFile|writeFile|createDirectory|getMetadata|canonicalize|readDirectory|remove|copy`.
> Transports: `ws://IP:PORT`, `--remote URL --environment-id ID` (registry + Noise
> relay), `forward --connect ws://HOST:PORT …`.

**[V]** `codex-rs/exec-server/README.md` (561 lines; covers auth, relay framing,
session resume, `environmentInfo`).

So the model loop, history, approvals and streaming all stay in the app-server
process; only _execution and file access_ hop to the remote machine. **[V]** for
the RPC split; **[I]** for "model loop does not hop" — nothing in the exec-server
protocol carries model turns, and the app-server is what emits `turn/*` and
`item/*` events.

### 1b. Remote host = a _remote app-server_, reached by the client

For "Codex on another machine" the client does not talk to an exec-server; it
starts a whole app-server there:

> "Remote connections use SSH to start and manage the remote Codex app server."
> "The app starts the remote Codex app server through SSH, using the remote user's
> login shell. Make sure the `codex` command is available on the remote host's
> `PATH`."

**[V]** `https://learn.chatgpt.com/docs/remote-connections.md`

Transports accepted by the client (`codex --remote`): `ws://`, `wss://`,
`unix://`, `unix://PATH`; app-server listens on `stdio://` (default, JSONL),
`ws://IP:PORT`, `unix://`, or `off`. **[V]** `https://learn.chatgpt.com/docs/app-server.md`
and `https://learn.chatgpt.com/docs/developer-commands.md` (`codex app-server`).

The remote client code is explicit that this is the _same_ protocol as the
in-process path:

> "It owns the remote connection lifecycle … Remote connections always carry
> WebSocket frames, over either TCP WebSocket URLs or local Unix sockets. The rest
> of the crate uses the same `AppServerEvent` surface for both in-process and
> remote transports, so callers such as the TUI can switch between them without
> changing their higher-level session logic."

**[V]** `codex-rs/app-server-client/src/remote.rs` (module header).

And the in-process client is shared by CLI surfaces:

> "Shared in-process app-server client used by conversational CLI surfaces:
> `codex-exec`, `codex-tui` … JSON serialization is still used at external
> transport boundaries (stdio/websocket), but the in-process hot path is typed."

**[V]** `codex-rs/app-server-client/README.md`

There is also a daemon + relay path so a machine can be reachable from the desktop
or mobile app without exposing app-server: `remoteControl/*` RPCs
(`enable|disable|status/read|pairing/start|pairing/status|client/list|client/revoke`)
with `RemoteControlConnectionStatus { disabled, connecting, connected, errored }`
and an `environmentId` identity. **[V]**
`codex-rs/app-server-protocol/src/protocol/v2/remote_control.rs`,
`codex-rs/app-server-daemon/README.md` ("backs the machine-readable `codex
app-server` lifecycle commands used by remote clients such as the desktop and
mobile apps … intended for Codex instances launched over SSH"), and
`https://learn.chatgpt.com/docs/remote-connections.md` ("A secure relay layer
keeps trusted machines reachable across your authorized ChatGPT devices without
exposing them directly to the public internet.").

### 1c. Codex Cloud = a different backend protocol, not app-server JSON-RPC

Cloud tasks are **not** served by app-server. There are two surfaces:

- Task CRUD over HTTP (`/api/codex/tasks`, `/wham/tasks/{id}`,
  `/wham/environments/by-repo/{provider}/{owner}/{repo}`, …). **[V]**
  `codex-rs/cloud-tasks-client/src/http.rs`, `codex-rs/cloud-tasks/src/env_detect.rs`.
- Live thread traffic over **native gRPC**, service
  `oaiproto.codex_app_server_backend.ThreadService`, methods `Resume` and `Attach`:

> "Reusable Rust client for native ThreadService gRPC over HTTP/2, with no TUI,
> conventional app-server or private monorepo dependency. … It does not use the
> HTTP `/grpc` JSON gateway. … `Attach` has no history snapshot or replay
> guarantee. Dropping it detaches without stopping the thread or answering
> approvals."

**[V]** `codex-rs/cloud-client/README.md`, `codex-rs/cloud-client/src/lib.rs`,
`codex-rs/cloud-client/src/wire.rs`.

The event envelopes in `Attach` are `Notification` or `ServerRequest` — the same
two categories app-server uses, but protobuf-encoded rather than JSON-RPC:

> "Payloads are native Notification/ServerRequest messages, not JSON-RPC or
> ProtoJSON." / "Extended nested protobuf message bytes, preserving unknown fields."

**[V]** `codex-rs/cloud-client/src/types.rs`, `codex-rs/cloud-client/src/wire.rs`.
**[I]** The cloud backend therefore reuses app-server's _event vocabulary_
(notifications vs server requests) while replacing the transport — which is why a
client can share rendering code but not the transport adapter.

The same split shows up inside app-server as cloud-only escape hatches:
`thread/resume.history`, marked
"[UNSTABLE] FOR CODEX CLOUD - DO NOT USE. If specified, the thread will be resumed
with the provided history instead of loaded from disk", and
`thread/start.experimentalRawEvents` ("for internal use only (e.g. Codex Cloud)").
**[V]** `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`.

### Where thread state lives

- Local/remote-host app-server: server-side, next to the app-server process —
  JSONL rollout files plus a SQLite state DB for queryable metadata.
  "`LocalThreadStore` persists history through `codex-rollout` JSONL files and
  persists queryable metadata through the SQLite state database when available."
  **[V]** `codex-rs/thread-store/README.md`. Therefore a remote host's threads live
  on the remote host, and reconnect means `thread/resume` (or `thread/read` +
  `thread/turns/list`).
- Cloud: the backend's ThreadService holds the thread; the client only
  `Resume`s/`Attach`es and has "no history snapshot or replay guarantee". **[V]**
  `codex-rs/cloud-client/README.md`. Product doc: "Reopen the same task to
  continue its work across devices … Tasks in Codex Cloud can keep working while
  your computer is asleep." **[V]**
  `https://learn.chatgpt.com/docs/environments/cloud-environments.md`

---

## 2. Is the composer ONE component or two?

**One composer, one destination control.** Best evidence, strongest first:

1. **Code**: the TUI's cloud "new task" page embeds the _same_ composer widget as
   interactive chat.
   `codex-rs/cloud-tasks/src/new_task.rs`:

   ```rust
   use codex_tui::ComposerInput;
   pub struct NewTaskPage { pub composer: ComposerInput, pub submitting: bool,
                            pub env_id: Option<String>, pub best_of_n: usize }
   ```

   and `codex-rs/tui/src/public_widgets/composer_input.rs` documents itself as:
   "Public wrapper around the internal ChatComposer for simple, reusable text
   input … suitable for other crates (e.g., codex-cloud-tasks) to reuse the mature
   composer behavior: multi-line input, paste heuristics, Enter-to-submit, and
   Shift+Enter for newline." **[V]**

2. **Product doc**: the desktop composer carries a _destination menu_, not a
   different composer per destination:
   "Desktop composer with the Work in menu open to This computer and Cloud, and a
   separate Worktree option"; and "When starting a Codex chat, choose where it
   runs: **Local** … **Worktree** … **Cloud**". **[V]**
   `https://learn.chatgpt.com/docs/environments/modes.md`

3. **Product doc (IDE)**: the same composer's slash commands switch destination:
   `/cloud` "Run the chat in the cloud, when cloud execution is available",
   `/local` "Run the chat in your local workspace",
   `/cloud-environment` "Choose the cloud environment for the chat".
   **[V]** `https://learn.chatgpt.com/docs/developer-commands.md` (IDE surface).

4. **Product doc**: a running chat can be _moved_ between hosts from the composer
   footer — again one UI, changing destination:
   "In the chat footer, select the current run location, then select the
   destination host … Review the destination and branch, then select **Hand off**."
   **[V]** `https://learn.chatgpt.com/docs/remote-connections.md`

**What is genuinely separate:** the _transport adapter_ and the _capability
projection_, not the composer. Local/remote-host chats speak app-server JSON-RPC
over stdio/WebSocket/Unix socket; cloud chats speak ThreadService gRPC plus task
REST. **[V]** (§1). **[I]** The host-specific parts are: which RPC client is
mounted, whether "cloud environment" is a valid destination, and which
capabilities the destination reports.

**Not verifiable:** the desktop app and the IDE extension are closed source; their
actual React/TSX component tree is not in `openai/codex`. The repo ships only
_generated_ TypeScript bindings (`codex-rs/app-server-protocol/schema/typescript/**`,
including `v2/ThreadEnvironment.ts`, `v2/TurnSteerParams.ts`) and the
`generate-ts` / `generate-json-schema` commands. So "one shared component" is
verified for the TUI (code) and asserted at the product level for desktop/IDE
(docs + illustrations), but the desktop/IDE implementation detail is **[U]**.

---

## 3. Feature-by-feature: how composer capabilities behave remotely

Everything below is a _client→server RPC_ in app-server, which is why it behaves
the same locally and on a remote host: the RPC simply lands on the other machine.

| Composer capability                | Codex mechanism                                                                                                                                                                                                                        | Remote (host / environment)                                                                                                                                                                                                                                                                                                                                                                                                   | Cloud                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model list + picker                | `model/list` (paging, `includeHidden`, `inputModalities`, `supportedReasoningEfforts`); "Call `model/list` to discover available models … before rendering model or personality selectors"                                             | **Remote API call** — the remote app-server answers from _its_ account/profile. `TurnStartParams.model` / `effort` override per turn and stick. **[V]** app-server doc + `turn.rs`                                                                                                                                                                                                                                            | **Not in the open-source task API**: `create_task(env_id, prompt, git_ref, qa_mode, best_of_n)` carries no model/effort. **[V]** `cloud-tasks-client/src/api.rs`, `http.rs` body `new_task: { environment_id, branch, run_environment_in_qa_mode }`. Where the cloud model is chosen is **[U]**                                                                                                                                                                               |
| File mentions (`@`)                | client uses `fuzzyFileSearch` (+ streaming session API `fuzzyFileSearch/sessionUpdated                                                                                                                                                 | sessionCompleted`), then `turn/start.input`gets`{ type: "mention", name, path }`; `/mention` also exists in docs                                                                                                                                                                                                                                                                                                              | **Remote API call, in practice** — `run_fuzzy_file_search(roots, query)` resolves plain `PathBuf` roots _inside the app-server process_, so a remote app-server searches the remote filesystem. **[V]** for the mechanism (`app-server/src/fuzzy_file_search.rs`, mention input in `v2/turn.rs`); **[I]** that remote works because roots are environment-native (`ThreadEnvironment.cwd`, "environment-native paths")                                                        | Cloud composer has no `@` path workflow documented; the task form is prompt + env + branch. **[U]**                                                                 |
| Image attachments                  | `UserInput::Image { image: Inline{url}                                                                                                                                                                                                 | File{file_id}, detail }`or`LocalImage { path, detail }`; images are normalized to data URLs / attachment store                                                                                                                                                                                                                                                                                                                | **Inline data URL = portable.** Path form is read where core runs (the host), so a client-local screenshot path is not portable. Also: **remote http(s) image URLs are rejected** — `"remote image URLs are not supported; use an inline data URL instead"`, and an omitted-content placeholder `"image content omitted because remote image URLs are not supported"`. **[V]** `app-server/src/image_url.rs`, `core/src/image_preparation.rs`; portability conclusion **[I]** | Same rejection applies; cloud task `input_items` in the OSS client build only a text `message` (+ optional `pre_apply_patch`). Images from the cloud UI are **[U]** |
| Queued messages while running      | Server-side queue: `thread/queue/add                                                                                                                                                                                                   | list                                                                                                                                                                                                                                                                                                                                                                                                                          | update                                                                                                                                                                                                                                                                                                                                                                                                                                                                        | delete                                                                                                                                                              | reorder                                                                                                                                                                                                                                                                                                       | start`, notification `thread/queue/changed`, type `QueuedSubmission { id, input, clientUserMessageId }`; `start`is "start if idle" and errors on`NotIdle`; ephemeral threads refuse queueing                                                                                                                                                                | **Remote API call, shared state** — the queue lives on the server, so every client (and a reconnect) sees the same queue. Product: "Queued messages appear above the composer, where you can edit, reorder, send, or delete them." `codex queue --thread … --remote` exists. **[V]** `request_processors/thread_queue_processor.rs`, `common.rs`, `prompting.md`, `developer-commands.md` | **[U]** — no queue RPC in the OSS cloud client slice |
| Steering while running             | `turn/steer { threadId, input, expectedTurnId }`; fails if no active turn or `expectedTurnId` mismatches; emits no new `turn/started`; rejects turn-level overrides                                                                    | **Remote API call** — same RPC, same semantics. Product: "Steer adds the message to the current run … In Codex CLI, press Enter while Codex is working to steer the current turn, or Tab to queue". Mobile docs: "Send follow-up instructions, answer questions, and steer active work." **[V]** `v2/turn.rs`, app-server doc, `prompting.md`, `remote-connections.md`                                                        | Doc says "request follow-up changes" after a task; in-flight steering is **[U]**                                                                                                                                                                                                                                                                                                                                                                                              |
| Slash commands / prompt snippets   | slash commands are a _client-side_ command table (`tui/src/slash_command.rs`), executed either locally or by issuing the corresponding RPC; queued slash commands are "parsed when they run"                                           | **Local approximation** — they work remotely because each command maps to an RPC or local UI action; but host-dependent ones change meaning (`/worktree`, `/cloud`, `/cloud-environment`). Explicit remote caveat: `` `tui.resume_cwd = "current"` requires `--cd` when using a remote workspace ``. **[V]** snapshot `remote_resume_current_cwd_rejected`, `/cloud*`+`/local` table                                          | Same table in the IDE (`/cloud`, `/cloud-environment`, `/local`)                                                                                                                                                                                                                                                                                                                                                                                                              |
| Approvals                          | server-initiated JSON-RPC _requests_: `item/commandExecution/requestApproval`, `item/fileChange/requestApproval`, `item/permissions/requestApproval`, `mcpServer/elicitation/request`, `tool/requestUserInput`; client replies `accept | acceptForSession                                                                                                                                                                                                                                                                                                                                                                                                              | decline                                                                                                                                                                                                                                                                                                                                                                                                                                                                       | cancel`, then `serverRequest/resolved`                                                                                                                              | **Remote API call** — the approval decision travels to the remote app-server, which resumes or declines there. `permissions/requestApproval` even carries `environmentId`. Mobile doc: "Approve commands and other actions." **[V]** app-server doc §§Approvals, `v2/permissions.rs`; `remote-connections.md` | **[U]** in the OSS slice (cloud approvals are handled by the web/mobile client)                                                                                                                                                                                                                                                                             |
| Skills / plugins                   | `skills/list`, `skills/config/write`, `plugin/*`; skills invoked as `$name` + a `skill` input item                                                                                                                                     | **Remote API call** — resolved on the host. `environment/add` can even declare `skills.required` ("checked before model inference"). **[V]** `v2/environment.rs`, app-server doc §Skills                                                                                                                                                                                                                                      | **Explicit gap**: "Skills stored in your repository are available in cloud tasks. Personal skills from your local computer aren't synced to cloud environments." **[V]** `cloud-environments.md`                                                                                                                                                                                                                                                                              |
| Client-side file browsing (`fs/*`) | `fs/readFile                                                                                                                                                                                                                           | writeFile                                                                                                                                                                                                                                                                                                                                                                                                                     | readDirectory                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | watch                                                                                                                                                               | …`                                                                                                                                                                                                                                                                                                            | **Unavailable for remote**: app-server's client-facing `fs/*` binds to `environment_manager.try_local_environment()` and errors `"local filesystem is not configured"` if absent — i.e. the _client_ fs API is local-only, while the _agent's_ file access goes through the thread environment. **[V]** `app-server/src/request_processors/fs_processor.rs` | n/a                                                                                                                                                                                                                                                                                                                                                                                       |
| Local computer resources           | —                                                                                                                                                                                                                                      | **Explicitly not transferred**: "A cloud task uses the files and services available in its cloud environment. Your computer's local files, running processes, browser sign-ins, and VPN access aren't automatically transferred to it." For a _connected host_ the opposite holds: repositories, shell, MCP, skills, browser, signed-in apps all come from the host. **[V]** `environments/modes.md`, `remote-connections.md` | Same quote                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Two portable-design takeaways from the table:

- The **queue and the steering channel are server-side**, so "disable the composer
  while remote" is never necessary for correctness. **[V]**/**[I]**
- Attachments are portable when **inlined** (`data:` URL) and host-local when
  passed by path — the server even refuses http(s) URLs. **[V]**

---

## 4. Task creation: how the same composer starts cloud work

What the user sees **[V, docs]**:

1. Open a new task; `Work in > Cloud`; `Select environment` (a published
   environment, with `Create environment` / `Manage environments` beneath it).
2. Pick a GitHub repo set _when creating the environment_ — the environment owns
   repositories, dependencies, tools and access; publishing snapshots the
   prepared filesystem.
3. Send. "Each new task gets its own isolated workspace from the published
   environment."
4. Later: "Reopen the same task to continue its work across devices."

So "repo selection" happens at **environment creation**, not at each task; the
task picks _environment_ + _branch_.

What the wire carries **[V, code]** — `create_task(env_id, prompt, git_ref, qa_mode,
best_of_n)` posts:

```json
{
  "new_task": { "environment_id": "<env>", "branch": "<git_ref>", "run_environment_in_qa_mode": false },
  "input_items": [
    { "type": "message", "role": "user", "content": [{ "content_type": "text", "text": "<prompt>" }] },
    { "type": "pre_apply_patch", "output_diff": { "diff": "<…>" } }
  ],
  "metadata": { "best_of_n": 2 }
}
```

`pre_apply_patch` is only added when `CODEX_STARTING_DIFF` is set — i.e. the CLI
can ship the local uncommitted diff into the cloud task. **[V]**
`codex-rs/cloud-tasks-client/src/http.rs`.

Defaults and disambiguation **[V]**:

- `codex cloud exec --env <ENV_ID> [--branch <BRANCH>] [--attempts 1..4]` — "Git
  branch to run in Codex Cloud (defaults to current branch)"
  (`codex-rs/cloud-tasks/src/cli.rs`).
- Environment auto-detection uses the local git origin:
  `GET {base}/wham/environments/by-repo/github/{owner}/{repo}`, then ranks rows
  (`is_pinned`, `task_count`) and falls back to listing all environments
  (`codex-rs/cloud-tasks/src/env_detect.rs`).
- The TUI's cloud page maps `Ctrl+O` to "env" and `Ctrl+N` to "attempts" on the
  shared composer (`cloud-tasks/src/new_task.rs` hint items).

**What changes "at that moment" in the composer** **[V, docs]** — the destination
control changes, and the local-context affordances stop applying:

- the run location shows Cloud / the environment, later visible and changeable in
  the chat footer (handoff) — though "handoff to a Codex cloud environment isn't
  supported";
- local files/processes/browser/VPN are no longer inputs;
- local personal skills are not synced;
- the result comes back as a diff/PR you review (the CLI even has
  `codex apply <TASK_ID>` to apply a cloud task's diff locally).

**Note:** starting a cloud task is _not_ `thread/start` on app-server. It is a
task-creation POST plus a ThreadService `Resume`/`Attach`. **[V]** §1c.

---

## 5. Reconnect / resume semantics that shape the composer

1. **Reconnect keeps a full, restricted composer — not a plain textarea.** When the
   transport drops, the TUI enters `RestrictedInputMode::{Disconnected,
UnavailableThread}`: pastes are expanded, image selection cleared, submission
   suppressed, but _drafts, attachments, mentions and paste placeholders are
   preserved_, and only commands valid offline (`/warnings`, `/config`,
   thread-unavailable commands) may still run.
   "Other commands and prompts stay in the draft while offline. The basic editor
   reconciles attachments without invoking composer-level shortcuts."
   **[V]** `codex-rs/tui/src/bottom_pane/chat_composer/reconnect.rs`,
   `.../chat_composer/reconnect_tests.rs`, snapshot
   `…reconnect__tests__offline_delete_after_wheel.snap`.
2. **Subscribe/unsubscribe is explicit.** "`thread/unsubscribe` - unsubscribe this
   connection from thread turn/item events. If this was the last subscriber, the
   server unloads the thread after a no-subscriber inactivity grace period and
   emits `thread/closed`." `thread/loaded/list` reports what is in memory;
   `thread/status/changed` reports runtime status. **[V]** app-server doc.
3. **Resume is paginated, not a snapshot.** `thread/resume` takes `excludeTurns`
   plus `initialTurnsPage`, and returns `turnsBackwardsCursor` /
   `itemsBackwardsCursor`; "Full-history hydration is deprecated for paginated
   threads; use this with `thread/turns/list` and `thread/items/list`". **[V]**
   `v2/thread.rs`.
4. **A running turn survives client detach — for cloud explicitly:** "Dropping
   [`Attach`] detaches without stopping the thread or answering approvals", and
   `ResumeRequest.wait = false` "acknowledges admission, not readiness".
   **[V]** `cloud-client/README.md`. For app-server, the equivalent is the daemon
   keeping the thread loaded + `thread/resume` in another client
   (`app-server-daemon/README.md`, `daemon_thread_recovery.rs`).
5. **Environment-level resume is separate from thread-level resume.** An exec-server
   connection resumes by session id (`resume_session_id`) and re-establishes
   stream state (`RelayResume { next_seq }`, ack/ack_bits) — "The existing harness
   reconnect flow can then resume a retained destination session."
   **[V]** `exec-server/src/client_transport.rs` (`ExecServerReconnectStrategy`),
   `client_recovery.rs`, `proto/codex.exec_server.relay.v1.proto`,
   `exec-server/README.md`.
6. **Queued follow-ups are durable server state**, so they survive a client
   reconnect and are visible from any client (`thread/queue/list` +
   `thread/queue/changed`). **[V]** §3.
7. **No replay guarantee** for cloud attach: "`Attach` has no history snapshot or
   replay guarantee." Clients must re-`Resume`/re-read history. **[V]**

Shape imposed on the composer: it must be able to exist while _not_ able to
submit; it must render queued items as editable data (not local pending state);
and it must be able to rehydrate history in pages after reconnect. **[I]**

---

## 6. Explicit notes about not proxying the whole UI

There is **no document that literally says "do not proxy the UI"**. What exists is
an architecture that makes proxying unnecessary, stated in several places:

- "Codex app-server is the interface Codex uses to power rich clients (for example,
  the Codex VS Code extension). Use it when you want a deep integration inside
  your own product: authentication, conversation history, approvals, and streamed
  agent events." **[V]** `app-server.md`
- "The rest of the crate uses the same `AppServerEvent` surface for both in-process
  and remote transports, so callers such as the TUI can switch between them
  without changing their higher-level session logic." **[V]**
  `app-server-client/src/remote.rs`
- "This exposes a minimal interface suitable for other crates (e.g.,
  codex-cloud-tasks) to reuse the mature composer behavior." **[V]**
  `tui/src/public_widgets/composer_input.rs`
- The remote host is reached by _starting a server there_, not by streaming its
  UI: "The app starts the remote Codex app server through SSH." **[V]**
  `remote-connections.md`
- "Remote access uses the connected host's projects, chats, files, credentials,
  permissions, plugins, Computer Use, browser setup, and local tools", while the
  phone "sends prompts, approvals, and follow-up messages". **[V]** same doc.
- Odd-man-out: **cloud is a second backend**, reached with ThreadService gRPC and
  task REST, not app-server — "with no TUI, conventional app-server or private
  monorepo dependency", "These are not ProtoJSON or app-server JSON-RPC". **[V]**
  `cloud-client/README.md`

**[I]** The reusable strategy is: define the _semantic_ protocol (thread, turn,
item, approval-request, queue), then implement one client against it and swap
transports (in-process channels / stdio JSONL / WebSocket / Unix socket) or, for a
fundamentally different backend, keep the event categories and re-encode them
(gRPC). UI-level capabilities are then _projections_ of what the connected
endpoint answers, never a separate screen.

---

## 7. What this implies for DSH `multi-host`

**[I], grounded in the evidence above:**

1. The degraded plain-textarea composer is the wrong fallback. Codex's own fallback
   keeps the rich composer and _restricts submission_ while preserving drafts,
   attachments and paste state (`RestrictedInputMode`). Cheapest improvement with
   the highest fidelity.
2. Model the destination as data attached to the thread/turn
   (`ThreadEnvironment { environmentId, cwd, workspaceRoots }` + sticky
   `environments` on start/resume/turn), not as a different composer variant. One
   `Work in` control; the capability set follows from the endpoint's answers.
3. Put the queue and the steer channel on the Host, not in the browser: Codex has
   `thread/queue/*` + `turn/steer { expectedTurnId }` precisely so reconnects and
   multiple clients agree. A client-side queue would diverge.
4. Inline attachments (`data:` URL) for portable images; never assume a remote can
   read a client path. Codex refuses http(s) image URLs outright.
5. For a remote DSH host, prefer "talk to the Host API that lives there"
   (Codex: start app-server over SSH) over "proxy the local UI". Where that is not
   possible, degrade per-capability and say which capability is unavailable —
   Codex ships explicit per-destination gaps ("not supported", "aren't synced",
   "not automatically transferred") rather than a silently weaker composer.
6. Do not copy Codex's cloud split: cloud is a second backend with its own gRPC
   service and no history replay. That is a product decision (task-oriented,
   server-owned workspaces), not a model `multi-host` needs.

---

## 8. URLs actually fetched

Product/protocol docs (all returned HTTP 200; `.md` variants used to bypass nav):

- https://learn.chatgpt.com/docs/app-server.md (via https://developers.openai.com/codex/app-server)
- https://learn.chatgpt.com/docs/cloud.md (via https://developers.openai.com/codex/cloud)
- https://learn.chatgpt.com/docs/environments/cloud-environments.md
- https://learn.chatgpt.com/docs/environments/modes.md
- https://learn.chatgpt.com/docs/remote-connections.md
- https://learn.chatgpt.com/docs/codex/ide.md (via https://developers.openai.com/codex/ide)
- https://learn.chatgpt.com/docs/developer-commands.md
- https://learn.chatgpt.com/docs/prompting.md
- https://learn.chatgpt.com/docs/app.md
- https://learn.chatgpt.com/llms.txt

Repo, pinned at `17a0e6f63fad13f577ef87b36b4ea37fc06385e9`
(`https://raw.githubusercontent.com/openai/codex/17a0e6f63fad13f577ef87b36b4ea37fc06385e9/<path>`):

Protocol / schema

- `codex-rs/app-server-protocol/src/protocol/v2/environment.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/remote_control.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread_attachment.rs`
- `codex-rs/app-server-protocol/src/protocol/common.rs`
- `codex-rs/app-server-protocol/schema/json/ClientRequest.json`
- `codex-rs/app-server-protocol/schema/json/codex_app_server_protocol.v2.schemas.json`
- `codex-rs/app-server-protocol/schema/json/v2/EnvironmentConnectionNotification.json`
- `codex-rs/app-server-protocol/schema/json/v2/RemoteControlStatusChangedNotification.json`

app-server

- `codex-rs/app-server/src/transport.rs`
- `codex-rs/app-server/src/message_processor.rs`
- `codex-rs/app-server/src/image_url.rs`
- `codex-rs/app-server/src/fuzzy_file_search.rs`
- `codex-rs/app-server/src/request_processors/environment_processor.rs`
- `codex-rs/app-server/src/request_processors/thread_queue_processor.rs`
- `codex-rs/app-server/src/request_processors/fs_processor.rs`
- `codex-rs/app-server/src/request_processors/turn_processor.rs`
- `codex-rs/app-server-client/README.md`, `codex-rs/app-server-client/src/remote.rs`
- `codex-rs/app-server-daemon/README.md`

Remote execution

- `codex-rs/exec-server/README.md`
- `codex-rs/exec-server/src/client_recovery.rs`
- `codex-rs/exec-server/src/client_transport.rs`
- `codex-rs/exec-server/src/proto/codex.exec_server.relay.v1.proto`
- `codex-rs/runtime-agent-instance/src/lib.rs`

Cloud

- `codex-rs/cloud-client/README.md`, `src/lib.rs`, `src/types.rs`, `src/wire.rs`
- `codex-rs/cloud-tasks/src/cli.rs`, `src/new_task.rs`, `src/env_detect.rs`
- `codex-rs/cloud-tasks-client/src/api.rs`, `src/http.rs`

Composer / client

- `codex-rs/tui/src/public_widgets/composer_input.rs`
- `codex-rs/tui/src/bottom_pane/chat_composer/reconnect.rs`
- `codex-rs/tui/src/bottom_pane/chat_composer/attachment_state.rs`
- `codex-rs/tui/src/slash_command.rs`
- `codex-rs/tui/src/chatwidget.rs`
- snapshots: `tui/src/snapshots/codex_tui__cwd_prompt__tests__cwd_prompt_remote_exec_modal.snap`,
  `tui/src/chatwidget/snapshots/codex_tui__chatwidget__tests__worktrees_command_remote.snap`,
  `tui/src/snapshots/codex_tui__app__tests__remote_resume_current_cwd_rejected.snap`

State / images

- `codex-rs/thread-store/README.md`
- `codex-rs/core/src/image_preparation.rs`

GitHub HTML (`https://github.com/openai/codex`) was fetched but is only useful for
orientation; all substantive claims use the raw files or docs above.
