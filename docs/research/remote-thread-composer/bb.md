# How bb runs threads on other machines — and what its composer does about it

Research for the DSH `multi-host` plugin (we currently render a degraded plain-textarea composer for remote threads).

bb version inspected: **0.46.1** (`/Applications/bb.app`; its app.asar and the public repo were read from a
scratch extraction, not copied into this repository — re-extract with `npx @electron/asar extract` to reproduce).
Upstream is public MIT: <https://github.com/get-bb/bb>. Source files were fetched from `main` into
the public repo, so every path below is a repository path.

---

## TL;DR — the strategy

**There is no remote composer.** bb has exactly one chat/composer stack (`NewThreadComposer` for the
new-thread screen, `PromptBoxInternal` + `FollowUpPromptBox` for thread follow-ups) and it always talks to
**the bb server the page was loaded from** (`window.location.origin`). A thread on another machine is the same
thread shape with `environment.hostId != localHost`; the difference is entirely _data_: which target id travels in
the request, which machine the **server** dispatches the typed command to, and what the server reports back as
capabilities/errors. The browser never opens a second API client, socket or transport per machine.

That is the pattern to copy: keep one composer, make the execution target an argument on every request, and put the
fan-out in the Host (server) layer behind an id-routed command bus.

---

## 1. How a "machine"/host/daemon is modeled and transported

### The model

- `Host` is the machine record: `packages/domain/src/host.ts`

  ```ts
  export const hostSchema = z.object({
    id: z.string(), name: z.string(),
    type: z.enum(["persistent", "ephemeral"]),
    status: z.enum(["connected", "disconnected"]),
    machineProviderId: z.string().nullable(),
    lifecycle: machineLifecycleSchema,            // creating|active|suspending|suspended|resuming|removing|destroyed
    maxPermissionMode: permissionModeSchema,
    lastSeenAt: z.number().nullable(),
    lastRejectedProtocolVersion: z.number().int().positive().nullable(),
    …
  });
  ```

  One host is designated primary (`apps/app/src/hooks/queries/host-queries.ts:selectPrimaryHost`), and the local
  machine is just _another host_ in the same list (`MachinePicker.orderLocalHostFirst(hosts, localDaemonHostId)`).

### The transport

- Machines run a **host daemon** that dials **out** to the bb server over a WebSocket and answers a typed command
  protocol: `packages/host-daemon-contract/src/protocol.ts`
  (`HOST_DAEMON_PROTOCOL_VERSION = 247`, compatible `[246, 247]`) and a ~72 KB command dictionary in
  `packages/host-daemon-contract/src/commands.ts` (`host.browse_directory`, `host.list_branch_options`,
  `provider.list_models`, `turn.submit`, `interactive.resolve`, `workspace.*`, …). Commands declare a transport
  (`"settled" | "onlineRpc"`) and an `envLane: "read" | "write"`.
- Server side: `apps/server/src/services/hosts/online-rpc.ts` (`callHostOnlineRpc`,
  `callHostRetryableOnlineRpcForWork`, waits up to `HOST_DAEMON_RECONNECT_WAIT_MS = 5_000` for a reconnecting
  daemon) and `apps/server/src/services/hosts/live-command.ts` (long-running settled commands, 24 h timeout,
  results committed back into the DB).
- If the machine cannot reach the server directly, bb connect provides the tunnel/relay and a per-machine
  `https://<handle>.getbb.app` origin; the reverse proxy strips private headers, forwards WebSocket upgrades and
  keeps tenant cookies only: `apps/connect-next/src/forwarding.ts` (`upstreamHeaders`, `isPrivateHeader`,
  `GOT`…). The UI gates enrollment on this: `apps/app/src/components/machines/machine-server-access.ts`
  ("Machines cannot reach this bb yet", `isLocalOnlyUrl`), with `direct` vs `bb connect` providers.
- Plugin authors see the same surface: a plugin may ship a **host entry** that runs _on the machine_
  (`packages/plugin-sdk/src/host-contract.ts:ExperimentalHostEntry`) and is called per machine:

  ```ts
  export interface ExperimentalHostCallOptions {
    readonly hostId: string
    readonly signal?: AbortSignal
    readonly timeoutMs?: number
  }
  ```

  The user's own `bb-plugins/plugins/jujutsu` uses exactly that: `host.ts` = `experimental_defineHostEntry`
  running `jj`; `app.tsx` = `rpc.call("inspect", { path, hostId })`.

### Where authoritative thread state lives

**On the server, not on the machine.** The daemon executes; the server owns the DB (threads, environments, hosts,
queued messages, pending interactions, stored thread events — `packages/domain/src/stored-thread-event.ts`,
`packages/db/src/data/queued-thread-messages.ts`). Hence:

- "Reconnect machine … It keeps the machine's projects, environments and history."
  (`apps/app/src/components/machines/MachineReconnectDialog.tsx`)
- Only _execution_ is remote: `turn.submit`, `provider.list_models`, `host.*`, `workspace.*`, `interactive.resolve`.
- Browser realtime is a single WS to its own server (`apps/app/src/lib/ws.ts`, `WebSocketManager`), which
  multiplexes thread timeline/queue/interaction updates for every machine.

Consequence: a thread can outlive its machine being offline; the UI degrades to "Offline" data states, never to a
different transport.

---

## 2. Is the composer shared or reduced for remote threads? — **Shared, target-aware**

Evidence, in the order the data flows:

1. **One HTTP client, bound to the page origin** — `apps/app/src/lib/api-server.ts`

   ```ts
   const BASE_URL = typeof window === 'undefined' ? 'http://localhost' : window.location.origin
   const client = createApiClient(BASE_URL, { fetch: fetchWithAppSurface })
   export const apiClient = client.api.v1
   ```

   and `apps/app/src/lib/sdk.ts` (`createBrowserBbSdk({ baseUrl: BASE_URL })`). There is no `getClientForHost`.

2. **One new-thread composer, whose target is data** — `apps/app/src/components/promptbox/NewThreadComposer.tsx`.
   Its state carries hosts and the environment selection:

   ```ts
   connectedHostIds: ReadonlySet<string>;
   primaryHostId: string | null;
   parsedEnvironment: ParsedEnvironment;
   projectHostId: string | null;
   changeEnvironment: (value: string, providerMachine: EnvironmentMachineSelection | null) => void;
   onRequestMachineSetup?: (host: Host) => void;   // opens ProjectMachineSetupDialog for a missing machine
   ```

   `useHosts()` feeds the same list for local and remote (`selectHosts(hosts, "persistent")`,
   `host.status === "connected"` → `connectedHostIds`). The machine's name is only a label
   (`worktreeHostNameById`).

3. **One prompt box for every surface** — `apps/app/src/components/promptbox/PromptBoxInternal.tsx` (the editor,
   mentions, attachments, voice, pickers) is used by both root and follow-up composers; it has no `hostId` and no
   connection state of its own. `FollowUpPromptBox.tsx` adds only thread semantics (running/queue/steer) and passes
   the same prompt box down. Grep for `hostId` in `PromptBoxInternal.tsx`: **zero hits**.

4. **Routing happens server-side, per command, by `hostId`.** The browser calls e.g.
   `sdk.threads.send({ threadId, input, mode })`; the server resolves `threadTargetHostId` and calls
   `callHostOnlineRpcForWork({ command: turn.submit, hostId })` / `startLiveHostCommand`
   (`apps/server/src/services/threads/queued-messages.ts` imports `threadTargetHostId`, `attemptDispatch`).

5. **Machine-scoped pickers are components with a `hostId` prop, not a parallel UI tree** —
   `apps/app/src/components/pickers/MachinePicker.tsx`, `EnvironmentPicker.tsx`, and the SDK-documented
   `BranchPickerProps` (`packages/plugin-sdk/src/app-contract.ts`): _"The enrolled machine whose project checkout
   supplies the branch list. Null renders the picker disabled with no options."_

6. **Negative evidence**: no chunk/route named `RemoteComposer`/`RemoteThread` exists. The only `remote*` UI modules
   are `RemotePathBrowser.tsx` (remote directory picker), `remote-server-load.ts` (desktop loading another
   _server_), and the remote-dev-servers guide. Thread view, timeline and composer chunks are shared:
   `RootComposeView`, `NewThreadComposer`, `ThreadDetailView`, `QueuedMessagesList`, `InlineMessageEditorFrame`.

So: **one shared, target-aware composer**; the "thread transport abstraction" lives server-side as the host
command bus, and the client-side abstraction is just "`hostId` in the payload / query key".

---

## 3. Composer capabilities on a remote thread

| Capability                                       | How it works for a remote thread                                                                                                                                                                                                                                                                                                                  | Remote RPC?                                               | Evidence                                                                                                                                                                             |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Model list / reasoning / service tier            | Fetched for the **selected machine**: daemon `provider.list_models`; cached per `(environmentId, hostId, providerId, projectId)`. While switching machines the composer says _"Loading models from the selected machine..."_                                                                                                                      | **Remote RPC** (daemon) via server                        | `apps/app/src/lib/model-catalog-cache.ts`, `.../promptbox/NewThreadComposer.tsx:372`, `.bb/skills/verify-bb/features/composer.md`                                                    |
| Provider CLI status / auth (Codex, Claude…)      | Per-host check, prompts install on that machine                                                                                                                                                                                                                                                                                                   | Remote RPC                                                | `SystemExecutionOptionsModelLoadError` codes `provider_unavailable`/`missing_executable`/`auth_required`; `useHostProviderCliStatus({ hostId })` in `RootComposeView.tsx`            |
| Permission mode                                  | Value validated against the **host ceiling** (`host.maxPermissionMode`)                                                                                                                                                                                                                                                                           | Data from server                                          | `packages/domain/src/host.ts`, composer.md "compare with the host ceiling"                                                                                                           |
| `@` file/folder mentions                         | Path suggestions resolved for that thread's project/environment/host on the server (`host.list_paths`/`host.list_files`). A machine-absolute attachment carries `hostId`; sending it to a thread on another machine is **refused**.                                                                                                               | **Remote RPC** (server routes by host)                    | `apps/app/src/hooks/usePathSuggestions.ts` (`hostId?: string                                                                                                                         | null`), `packages/domain/src/shared-types.ts` (`localFile`/`localImage`+ optional`hostId`), `apps/server/src/services/projects/attachments.ts`: `` `${input.path} is on another machine; upload the file to use it here` `` |
| Attachments / screenshots / paste                | Bytes upload to the **server's project attachment store** (`POST /api/v1/projects/:id/attachments`), then are staged for the turn; a machine-local path is not accepted as an attachment. New-thread composer copies them to the destination project (`sdk.projects.attachments.copy`) and shows "Moving attachments to the selected project...". | Server-local upload, machine-independent                  | `apps/app/src/components/thread/embedded-chat/useComposerAttachmentUploads.ts`, `NewThreadComposer.tsx:1478`, `apps/server/src/services/projects/attachments.ts`                     |
| Queued messages                                  | First-class **server DB rows** (`queued_thread_messages`) with reasons/waits; dispatched to the thread's host when eligible. UI list is lazy and virtualized, reorderable, editable.                                                                                                                                                              | Server-owned, dispatch is remote                          | `apps/server/src/services/threads/queued-messages.ts`, `apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx`, `apps/app/src/lib/queued-message-reorder.ts`               |
| Steering                                         | A send **mode**, not a separate UI: `sendMessageModeSchema = ["queue-if-active","steer-if-active","auto","start","steer"]`; queued rows can be steered later (`sendQueuedMessageModeSchema = ["auto","steer"]`). Follow-up composer derives `FollowUpSubmitMode = ready                                                                           | queue                                                     | queue-while-stopping                                                                                                                                                                 | blocked` from turn state, never from host location.                                                                                                                                                                         | Provider-side, per thread | `packages/server-contract/src/api/threads.ts`, `packages/client-core/src/prompt/follow-up-submit-mode.ts`, `packages/client-core/src/prompt/threadDetailPromptSubmission.ts` |
| Slash commands / prompt snippets / history       | Builtin compose commands are client/plugin features; provider slash commands come from the machine (`provider.list_commands`). The `prompt-library` plugin ships a normal plugin (app + server) and works against any host.                                                                                                                       | Mixed: client-side snippets, remote for provider commands | `apps/app/src/components/promptbox/composer-commands.tsx`, `apps/host-daemon-contract commands.ts` (`provider.list_commands`), `plugins/prompt-library/{app.tsx,server.ts,store.ts}` |
| Approvals / questions (pending interactions)     | Stored server-side, projected into the timeline; resolving sends daemon `interactive.resolve` to that thread's host. Banner is shared; it does not know the machine.                                                                                                                                                                              | **Remote RPC**                                            | `apps/server/src/services/interactions/pending-interactions.ts`, `apps/app/src/components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx`                            |
| Branch picker (new thread)                       | Host-owned component: `host.list_branch_options` for `(hostId, projectId)`; null host → disabled, no options                                                                                                                                                                                                                                      | **Remote RPC**                                            | `packages/plugin-sdk/src/app-contract.ts:BranchPickerProps`, `apps/app/src/components/pickers/BranchPicker.tsx`                                                                      |
| Directory browser (new environment on a machine) | Dedicated remote-aware browser calling server routes that proxy `host.browse_directory`; create-folder via `sdk.files.mkdir({ hostId, path })`                                                                                                                                                                                                    | **Remote RPC**                                            | `apps/app/src/components/dialogs/RemotePathBrowser.tsx`, `apps/server/src/routes/hosts.ts`                                                                                           |
| Terminal                                         | Terminals belong to an environment/host; the thread's side panel lists them per host                                                                                                                                                                                                                                                              | **Remote RPC**                                            | `RootComposeView.tsx` terminal targets (`{kind:"host_path", hostId}`), `apps/app/src/components/thread/ThreadTerminalPanel.tsx`                                                      |

**Rule of thumb in bb:** anything touching the filesystem, git, provider process, terminal or the agent is a
host-daemon command; anything about _threads, turns, queues, drafts and interactions_ is server state; nothing in
the composer is a local approximation of a remote capability, and nothing is "unavailable because remote" —
only "unavailable because this machine is offline or missing an executable/auth".

---

## 4. Environment/machine picker at thread creation

- The new-thread screen is `apps/app/src/views/RootComposeView.tsx` → `NewThreadComposer`; the environment chip
  opens `EnvironmentPicker`, which _is_ the project/environment/machine picker:
  `machines?: EnvironmentPickerMachines` (`hosts`, `localDaemonHostId`, `primaryHostId`), machine menu entries
  encoded as `machine:<hostId>`, badges `Online`/`Offline`/`No host`, and an entry point for
  `onRequestMachineSetup(host)` → `ProjectMachineSetupDialog` (clone vs. existing folder via `RemotePathBrowser`).
  - `hostUnavailableReason`: `"No host connected"` / offline variant.
  - `orderLocalHostFirst` keeps the local machine first but it is the same option list.
- Selection value is the existing environment encoding, with `providerMachine` as a second argument when a
  provider (not an environment) is being targeted:
  `changeEnvironment(value, providerMachine: EnvironmentMachineSelection | null)`.
- The choice is remembered per project (`usePromptBoxMachinePreference(projectId)`).
- Navigation can seed a machine: `toCompose({ projectId, environmentId?, hostId? })`
  (`packages/plugin-sdk/src/app-contract.ts`) and `RootComposeView.readRootComposeEnvironmentTargetFromLocationState`
  (`{kind:"host", hostId}` → `selectHostForNewEnvironment`).
- What changes when you pick another machine:
  - **Project sources** (`projectSources` per host), so "existing path" is machine-scoped; if the project has no
    checkout there, the composer offers `ProjectMachineSetupDialog` (clone or use folder).
  - **Model catalog + provider CLI status** (query key includes `hostId`), hence the explicit loading string.
  - **Branch list** (`host.list_branch_options` for that host's checkout).
  - **Directory browser** (remote path browser instead of the OS dialog / local paths).
  - Submission payload gains the host (via environment or `providerMachine`); nothing client-side changes.
- A machine can be enrolled inline from this flow: `AddMachineDialog` prints an install command
  (`bb … --host-id <machine-id>`) and polls until the daemon connects; if machines cannot reach the server, bb
  blocks with "Machines cannot reach this bb yet" and offers direct URL vs bb connect.

---

## 5. What bb deliberately did **not** reuse (and the fallbacks)

1. **No per-thread remote UI, iframe or browser tab.** The whole app instance is bound to one server origin
   (`api-server.ts`). To drive a _different bb server_, the desktop opens that server's URL as the window's page
   (`apps/desktop/src/remote-server-load.ts`: "Could not reach this bb server", "Choose server…"), and the server
   list comes from `window.bbDesktop` (`apps/app/src/lib/server-choices.ts`, `useServerChoices.ts`). Machines are
   _not_ servers: they are daemons attached to your server, so no page switch is needed for a remote thread.
2. **No local filesystem approximation for remote paths.** The OS file dialog is replaced by
   `RemotePathBrowser` + `host.browse_directory`; an absolute path from another machine is rejected at the API
   boundary instead of being silently copied:
   `` `${input.path} is on another machine; upload the file to use it here` ``.
3. **No cross-machine attachment reference.** Machine-local files must be uploaded (server project store);
   composer attachments may not carry `hostId` into a thread on a different machine.
4. **No shared/merged thread list across servers.** Moving servers is a dedicated migration flow
   (`apps/app/src/components/machines/MoveServerDialog.tsx`, `ServerMoveOverlay.tsx`,
   `apps/server/src/routes/server-move.ts`), not a per-thread portability feature.
5. **No second websocket per machine in the browser.** The browser keeps one realtime socket to its server; the
   server multiplexes all daemons.
6. **Fallback when the machine cannot reach the server:** choose `direct` (a reachable URL) or `bb connect`
   (tunnel + `<handle>.getbb.app`), and if neither is configured the machine-enrollment UI is blocked with a
   reason (`machineServerAccessBlockedReason`). Reconnect is human-driven: `MachineReconnectDialog` prints a fresh
   command, `experimental_reconnect`, and suspended machines have lifecycle actions
   (`MachineLifecycleActions`, `MachineLifecycleNotice`).

---

## 6. Reconnect / offline semantics that shape the composer

- **Browser ↔ server** (`apps/app/src/lib/ws.ts`): states `connecting | connected | reconnecting`;
  ping 25 s / pong 5 s (1.5 s on resume), reconnection delay ≥250 ms with jitter, resubscribes every active
  realtime target on reconnect, and brief disconnects are smoothed: `useConnectionAwareQueryState` keeps showing
  `loading` for a **10 s grace period** instead of flipping to `unavailable`.
- **Server ↔ daemon**: reconnect waits (5 s) inside `online-rpc.ts`; a daemon disconnect is _hidden_ for
  `HOST_RECONNECT_GRACE_MS = LEASE_TIMEOUT_MS = 30_000` (`apps/server/src/services/hosts/host-disconnect-display.ts`,
  `apps/server/src/constants.ts`) so a quick blip does not paint the machine offline.
- **Composer behavior while a machine is offline**: the target picker shows `Offline`/`No host` and new-thread
  submission is blocked by the environment/`submissionEnvironmentUnavailable` reason; a follow-up composer reports
  `FollowUpSubmitMode = { kind: "blocked", reason: "unavailable" }`; queued messages stay as server rows with a
  wait reason and dispatch when the host returns. Attempts surface `host_unavailable` API errors rather than
  disabling the editor.
- **Drafts survive everything**: drafts are persisted (localStorage/draft controller) independently of the
  machine connection; plugin composers get `submittingBlockedReason` / `isSubmittingBlocked` so blocking is
  explainable instead of silent.
- Machine lifecycle (suspend/resume/destroy, ephemeral providers) is modelled as data on `Host.lifecycle`, with
  `MachineLifecycleNotice` rendering the server's message — the composer just shows the state.

---

## 7. Files actually read

Local artifacts:

- `/Applications/bb.app/Contents/Resources/app.asar` → extracted app asar (v0.46.1)
  - app asar `node_modules/@bb/connect-client/src/{credential,urls,desktop-session,list-servers,redeem-machine,mobile-pairing,errors,base-url}.ts`
  - app asar `node_modules/@bb/domain/src/host.ts`
  - app asar `node_modules/@bb/host-daemon-contract/src/{protocol,commands}.ts`
  - app asar `node_modules/bb-app/app/dist/assets/` chunk inventory (names prove the component split:
    `NewThreadComposer`, `RootComposeView`, `QueuedMessagesList`, `AddMachineDialog`, `MachineSettingsView`,
    `MachineRenameDialog`, `ProjectMachineSetupDialog`, `BranchPicker`, `ModelReasoningMenu`,
    `machine-provider-queries`, `machine-server-access`, `host-mutations`, `thread-runtime-mutations`,
    `environment-workspace-display`, `workspace-checkout-display`, `ThreadPendingInteractionBanner`, …)
- The locally inspected `bb-plugins` source at `plugins/jujutsu/{package.json,host.ts,app.tsx}` and the SDK type bundle
  `…/node_modules/@get-bb/plugin-sdk/bundled-types/bb-plugin-sdk-app.d.ts` (host commands are `hostId`-scoped).

Upstream (`https://github.com/get-bb/bb/blob/main/<path>`, read at that path):

- `apps/app/src/lib/api-server.ts`, `apps/app/src/lib/sdk.ts`, `apps/app/src/lib/model-catalog-cache.ts`
- `apps/app/src/lib/ws.ts`
- `apps/app/src/hooks/useServerConnectionState.ts`, `hooks/useServerChoices.ts`, `lib/server-choices.ts`
- `apps/app/src/hooks/queries/{connection-aware-query-state,host-queries,machine-provider-queries,thread-default-execution-options-query}.ts`
- `apps/app/src/hooks/mutations/host-mutations.ts`
- `apps/app/src/hooks/{usePathSuggestions,pathMentionSuggestions}.ts`
- `apps/app/src/views/RootComposeView.tsx`
- `apps/app/src/components/promptbox/{NewThreadComposer,NewThreadPromptBox,FollowUpPromptBox,PromptBoxInternal,ExecutionControls,composer-commands}.tsx`
- `apps/app/src/components/promptbox/banner/QueuedMessagesList.tsx`
- `apps/app/src/components/promptbox/mentions/MentionMenu.tsx`
- `apps/app/src/components/pickers/{EnvironmentPicker,MachinePicker,BranchPicker}.tsx`, `environment-picker-value.ts`
- `apps/app/src/components/dialogs/{RemotePathBrowser,ProjectMachineSetupDialog}.tsx`
- `apps/app/src/components/machines/{machine-server-access,MachineReconnectDialog,MachineLifecycleNotice}.tsx`
- `apps/app/src/components/thread/embedded-chat/useComposerAttachmentUploads.ts`
- `apps/app/src/components/thread/pending-interactions/ThreadPendingInteractionBanner.tsx`
- `apps/desktop/src/remote-server-load.ts`
- `apps/server/src/services/hosts/{online-rpc,live-command,host-disconnect-display}.ts`
- `apps/server/src/services/projects/attachments.ts`
- `apps/server/src/services/threads/{queued-messages,queued-message-dispatch}.ts`
- `apps/server/src/routes/{hosts,queue}.ts`, `apps/server/src/constants.ts`
- `apps/connect-next/src/forwarding.ts`
- `packages/domain/src/{host,shared-types}.ts`
- `packages/plugin-sdk/src/{host-contract,app-contract}.ts`
- `packages/client-core/src/prompt/{follow-up-submit-mode,threadDetailPromptSubmission,prompt-draft}.ts`
- `packages/host-daemon-contract/src/{protocol,commands}.ts`, `packages/server-contract/src/api/{hosts,system,threads}.ts`
- `.bb/skills/verify-bb/features/composer.md` (bb's own feature/verification spec for the composer)
- `apps/web/src/guides/pages/remote-dev-servers.tsx` (user-facing model: Settings → Machines, project checkouts per
  machine, New thread → Worktree → pick machine/branch)

URLs: <https://github.com/get-bb/bb> · <https://getbb.app/guides/remote-dev-servers> ·
e.g. <https://github.com/get-bb/bb/blob/main/apps/app/src/lib/api-server.ts> ·
<https://github.com/get-bb/bb/blob/main/packages/host-daemon-contract/src/commands.ts> ·
<https://github.com/get-bb/bb/blob/main/packages/plugin-sdk/src/app-contract.ts>

---

## 8. What we should copy (for `multi-host`)

1. **One composer, target as data.** Keep DSH's rich composer (mentions, attachments, model/reasoning pickers,
   queued messages, approvals) for every thread; add a `target`/`hostId` to the request and query keys instead of
   forking a remote textarea. The moment a remote thread gets its own reduced component, every future capability
   has to be built twice — bb avoided that entirely.

2. **Route in the Host, not the Client.** Make the multi-host Host service own a typed, id-routed command bus
   (bb's `host-daemon-contract` + `online-rpc.ts`): the client calls one API surface, the Host resolves the target
   and dispatches. Model it as an argument (`{ hostId }`) on existing verbs, not as a second client/socket; the
   DSH equivalents are the existing `dshx` methods on the Host half plus a target id.

3. **Scope the capability providers by target, and let the UI say why.** Model catalog, branch options, provider
   CLI/auth status, directory listing and path suggestions all become `(hostId, projectId, …)`-keyed queries with
   explicit loading/error states ("Loading models from the selected machine…", `provider_unavailable`,
   `missing_executable`, `auth_required`). Never fake a remote capability locally, and never mark it unavailable
   merely because it is remote.

4. **Keep durable things on the Host.** Queues, steering intent, pending approvals/questions, drafts and thread
   state belong to the Host/DB; the machine only executes and streams. Then an offline machine is a _state_
   (queue rows wait, composer still accepts text, banner explains `blocked/unavailable`) rather than a broken
   composer — plus a short grace window (bb: 10 s client, 30 s host) so blips do not paint everything offline.

5. **Be strict about machine-local references.** Uploads go to a central store; a path from machine A must not be
   sent to a thread on machine B (bb returns `… is on another machine; upload the file to use it here`). For the
   few things that genuinely cannot cross (absolute paths, local checkouts, git branches), expose a dedicated
   remote-aware picker (`host.browse_directory`, `host.list_branch_options`) instead of degrading the whole
   composer.

6. **Give plugins/agents the same target-aware verbs.** bb's plugin SDK exposes `rpc.call(method, input, { hostId })`
   and a daemon-side host entry, so a plugin adds a remote feature without inventing a transport. In DSH terms:
   one bound `dshx` host method per verb that takes the target, so the Agent tool and the UI call the same thing.
