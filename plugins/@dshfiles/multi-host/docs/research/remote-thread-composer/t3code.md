# T3 Code: remote environments and the composer architecture

Source read: `/Users/astahmer/.references/t3code` (full checkout, 2026-10-13 snapshot).
Question asked: how does t3code support threads on OTHER machines, and how is the chat/composer
UI architected for that — so `@dshfiles/multi-host` can replace its degraded plain-textarea
remote composer with the same strategy.

**Key answer in one sentence:** t3code has exactly ONE composer (`ChatComposer.tsx`, used by one
`ChatView` hosted on a route that carries `environmentId`), and every capability it needs is an
RPC to the environment that owns the thread, gated at runtime by that environment's advertised
capabilities and by the _scope of the credential this client paired with_. There is no remote
UI, no proxy, no iframe, and no per-environment fork. What varies per environment is data and
permission, never the component.

---

## 1. How an "environment" is modeled, and where thread state lives

### Model

An environment = one running `t3 serve` and the machine, credentials, filesystem, and state it
owns (`AGENTS.md` glossary, `docs/internals/glossary.md`). It is modeled on the client as one
entry in a connection catalog plus one connection scope, keyed by a server-owned `EnvironmentId`
that survives restarts and endpoint changes (`docs/internals/remote.md`: "An environment keeps
its ID across server restarts and endpoint changes").

- Catalog entry: `packages/client-runtime/src/connection/catalog.ts:66` (`ConnectionCatalogEntry`)
  — a preferred `target` + `profile`, plus `alternateRoutes` in preference order.
- Route/profile kinds (`catalog.ts:19-53`): `BearerConnectionProfile` (direct http+ws origin,
  with `learned`/`authorization: "t3-connect"`/`network: "tailscale"` markers) and
  `SshConnectionProfile` (a desktop SSH target). Registrations (`catalog.ts:88-124`) add
  `PrimaryConnectionRegistration` (the local, same-origin cookie environment),
  `RelayConnectionRegistration`, `BearerConnectionRegistration`, `SshConnectionRegistration`.
- `apps/web/src/state/environments.ts` is the React surface: `useEnvironments()`,
  `useEnvironment(id)`, `usePrimaryEnvironmentId()`. The local server is _just the primary
  environment_, not a different code path: `apps/web/src/environments/primary/*` only handles
  discovery/auth bootstrap for it, and `apps/web/src/localEnvironment.ts` notes the desktop can
  run with **no** local environment at all (`localEnvironmentEnabled = false`), in which case
  `readPrimaryEnvironmentTarget` returns null and the renderer only connects saved environments.

### Transport

Three routes to the _same_ server; the execution model never changes:

1. **Direct HTTP + WebSocket per environment** (LAN, Tailscale, VPN, public URL). The hosted web
   app stores its catalog in the browser and connects straight to each environment —
   `docs/internals/remote.md:59-62`: _"It does not proxy traffic or hold server-side pairing
   state."_
2. **SSH**: desktop main owns lifecycle and forwards a port — `packages/ssh/src/tunnel.ts:1159`
   builds `-L <localPort>:127.0.0.1:<remotePort>`; the renderer then uses the _forwarded_
   endpoint through the shared connection runtime (`docs/internals/remote.md`, "SSH can launch a
   server as well as forward a port"; `packages/ssh/src/tunnel.ts:1083` "SSH desktop bridge only
   supports loopback forwarded URLs").
3. **T3 Connect relay**: brokering only. `docs/internals/t3-connect.md:5-6`: _"clients send
   application traffic through the environment's tunnel hostname; the relay Worker does not proxy
   their HTTP or WebSocket sessions."_ The relay mints a DPoP-bound bootstrap credential that the
   client exchanges **directly** with the environment for a session token the relay never sees.

Per-environment connection ownership: `packages/client-runtime/src/connection/registry.ts:93`
(`EnvironmentRegistry`) scopes connections by environment; `registry.run(environmentId, effect)`
and `followStream` are how every consumer gets "this environment's session". One transport retry
owner per environment lives in `packages/client-runtime/src/connection/supervisor.ts`
(`docs/internals/connection-runtime.md`: prevents competing reconnect loops).

### Authoritative state

Server-owned, always. Event log + projections + command receipts commit in one transaction
(`docs/internals/overview.md` "Durable intent and side effects",
`apps/server/src/orchestration-v2/EventSink.ts`). Clients hold **projections and a replay cursor**:
`packages/client-runtime/src/state/threads.ts:920` (`createEnvironmentThreadStateAtoms`) keeps
thread state per `(environmentId, threadId)` with a resume cache and `snapshotSequence`; the
runtime contract `packages/client-runtime/src/platform/persistence.ts` persists `loadShell/
saveShell/loadThread/saveThread/loadServerConfig/saveServerConfig/loadVcsRefs` per environment so
cached data stays readable offline ("Cached projections remain readable offline. They must
neither imply a live connection nor overwrite newer live data" — `connection-runtime.md`).

Every wire method is a typed RPC on that environment: `packages/contracts/src/rpc.ts:372`
(`WS_METHODS`: projects, filesystem, attachments, provider auth/install, vcs, terminal, preview,
server config, scheduled tasks, pull requests…) and `packages/contracts/src/orchestrationV2.ts:3251`
(`dispatchCommand`, `launchThread`, `subscribeShell`, `subscribeThread`, `subscribeArchivedShell`,
`searchThreads`, diffs…). Requests resolve against the _current_ session at execution time
(`packages/client-runtime/src/rpc/client.ts:131` `currentSession`, `:442` `request`), so a
reconnect or route change does not invalidate captured callers.

---

## 2. The composer strategy (the answer to copy)

**One composer. Target-aware. Never a remote variant.**

- Routes carry the environment: `apps/web/src/routes/_chat.$environmentId.$threadId.tsx` and
  `apps/web/src/routes/_chat.draft.$draftId.tsx` are both rendered by one layout component,
  `apps/web/src/components/ThreadRouteView.tsx`, which renders `<ChatView
environmentId={...} threadId={...} routeKind="server" | "draft" />` (`ThreadRouteView.tsx`
  ~line 93-110). A draft's environment travels with the draft, so a new thread can be born in
  another environment and promote onto the thread route with the same `ChatView` instance.
- One thread component: `apps/web/src/components/ChatView.tsx` (12.2k lines) passes a props bag
  to one composer: `apps/web/src/components/chat/ChatComposer.tsx` (7.8k lines),
  `ChatComposerProps` at `ChatComposer.tsx:1520` starts with
  `composerDraftTarget: ScopedThreadRef | DraftId` and `environmentId: EnvironmentId`.
- Every interior feature is an atom/command **parameterized by environmentId**, not a global
  store: `createEnvironmentRpcCommand` / `createEnvironmentRpcQueryAtomFamily`
  (`packages/client-runtime/src/state/runtime.ts`), e.g. attachments
  (`packages/client-runtime/src/state/attachments.ts:25`), filesystem read access
  (`state/filesystem.ts`), server config (`state/server.ts` → `createServerEnvironmentAtoms`),
  thread detail (`state/threads.ts:920`). The web only instantiates them:
  `apps/web/src/state/{attachments,filesystem,projects,server,terminal}.ts`.
- Data source selection is _not_ a hook branch on local vs remote. It is:
  1. **environment scope** — `ScopedThreadRef { environmentId, threadId }` travels everywhere
     (`packages/client-runtime/src/environment/scoped.ts`), and
  2. **capability negotiation** — the environment advertises
     `ExecutionEnvironmentCapabilities` (`packages/contracts/src/environment.ts:98`:
     `attachmentUploads`, `questionAttachments`, `fileAttachments.maxUploadBytes`,
     `pullRequests`, `inlineMessageContext`, `threadSettlement`, …all `optionalKey` and
     "Absent on servers from before X shipped, so clients must not probe them"), read in
     `ChatView.tsx:3015-3028` and turned into `supportsAttachmentUploads` /
     `supportsQuestionAttachments` / `maxFileAttachmentBytes` composer props, and
  3. **credential scopes** — `apps/web/src/state/session.ts:63` `readEnvironmentScope(envId,
scope)` + `useEnvironmentScope`, checked against that environment's `/api/auth/session`
     grant (`packages/contracts/src/auth.ts:83+`: `orchestration:operate`, `terminal:operate`,
     `source-control:write`, `filesystem:read`, `diagnostics:read`…), and
  4. **connection phase** — `environmentUnavailable: { label, connection }` prop
     (`ChatComposer.tsx:1569`) drives a disabled composer + `DISCONNECTED_COMPOSER_PLACEHOLDER`
     (`apps/web/src/composerPlaceholder.ts`).

So a remote thread over a narrow pairing is _the same composer with fewer enabled controls and
an explicit reason_, e.g. file search: `apps/web/src/state/queries.ts:230-282` gates
`projectEnvironment.searchEntries` on `useFilesystemReadAccess(envId)` and returns the message
"This connection cannot search host files." instead of hiding the feature.

Enforcement is server-side regardless: `packages/contracts/src/clientRpcPermissions.ts` +
`apps/server/src/auth/RpcAuthorization.ts` ("every RPC declares a required scope"), and
`AGENTS.md` "Taste": _"Grants are checked at execution against the destination environment; the
server remains authoritative."_ The client's scope reads only decide UI availability.

Naming worth stealing: the client concept is **"environment", not "remote host"**. There is no
`isRemote` anywhere in the chat UI (verified by grep: the only hits are git remote refs and
remote-clone flows). Local vs remote is a _route_, not a _mode_.

---

## 3. Feature-by-feature: how each composer capability works for a remote thread

Legend: **RPC** = the environment that owns the thread does the work; the client renders the
result. "Local" = client-side only. No feature is approximated locally; what cannot work is
hidden/disabled with a reason, or replaced by a capability-driven fallback.

| Capability                                   | Mechanism                                                                                                                                                                                                                                                                                                                                                                                                                 | Where                                                                                                                                                                                                                                                                                         |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Model list / provider instances              | RPC. `server.getConfig` + `subscribeServerConfig` per environment; `providers[]` with install/auth/availability status. Model picker is fed from props, never from a local catalog. Custom models live in the _server's_ `settings.json`.                                                                                                                                                                                 | `packages/contracts/src/rpc.ts` (`serverGetConfig`, `subscribeServerConfig`), `packages/client-runtime/src/state/server.ts`, `ChatView.tsx:3007-3013` (`serverConfig.providers`), `ChatComposer.tsx` props `providerStatuses`/`providerCatalogKnown`; `docs/user/composer.md` "Custom models" |
| File / directory mentions (`@`, path search) | RPC `projects.searchEntries` with `{cwd, query, kind, imageOnly}` against the thread's environment; gated on `filesystem:read`. Directory browse = `filesystem.browse`. Thread mentions (`@title`) resolve `orchestration.searchThreads` on the **same server**.                                                                                                                                                          | `apps/web/src/state/queries.ts:230-282`, `packages/contracts/src/rpc.ts` (`projectsSearchEntries`, `filesystemBrowse`), `packages/client-runtime/src/state/filesystem.ts:26`; `docs/user/composer.md` "Context in your message"                                                               |
| Attachments / images                         | RPC mint + HTTP byte transfer **to the environment**: `attachments.createUploadUrl` then upload to the env's `httpBaseUrl`, `assets.createUrl` for preview, `attachments.delete`. Capability-gated: `attachmentUploads`, `questionAttachments`, `fileAttachments.maxUploadBytes`. Uploads can only be sent to the environment they were uploaded to (`uploadEnvironmentId`/`environmentId` on the persisted file record). | `packages/client-runtime/src/state/attachments.ts:25`, `ChatView.tsx:3017-3028`, `apps/web/src/composerDraftStore.ts:193` (`PersistedComposerFileAttachment.environmentId`), `docs/user/composer.md` "Attach files"                                                                           |
| Queued messages                              | RPC, server-persisted. Commands `queue_after_active`, `queued-run.reorder/cancel/edit`, `queued-message.promote-to-steer`, `queue.resume`; UI `QueuedRunsControl.tsx` above the composer. Queue survives server restart and is _held_ until the user resumes.                                                                                                                                                             | `packages/contracts/src/orchestrationV2.ts:3022-3053`, `apps/web/src/components/chat/QueuedRunsControl.tsx`; `docs/user/composer.md` "Queued messages"                                                                                                                                        |
| Steering                                     | RPC to the running turn; client-side _policy_ is shared with mobile in `packages/client-runtime/src/state/composerDispatch.ts` (`resolveComposerDispatchMode`: queue vs steer, alternate modifier).                                                                                                                                                                                                                       | same + `docs/user/composer.md` "Send while the agent is working"                                                                                                                                                                                                                              |
| Prompt stash (snippets)                      | Client-local store (persisted), but attachments inside it are env-bound: "Stashes containing uploaded files must be restored in their original environment."                                                                                                                                                                                                                                                              | `apps/web/src/promptStashStore.ts`, `apps/web/src/components/chat/ComposerStashMenu.tsx`; `docs/user/composer.md` "Prompt stash"                                                                                                                                                              |
| Approvals / questions / permission modes     | RPC: `runtime-request.respond` (decision and/or answers, plus per-question attachments) and `thread.user-input.dismiss` commands; panels render from the thread projection. Runtime mode (`RuntimeMode`) is thread state changed by command, and it is also the MCP ceiling concept.                                                                                                                                      | `packages/contracts/src/orchestrationV2.ts:3055-3075`, `apps/web/src/components/chat/ComposerPendingApprovalPanel.tsx`, `ComposerPendingUserInputPanel.tsx`, `apps/web/src/components/chat/runtimeModeConfig.ts`; `docs/user/permission-modes.md`                                             |
| Terminals                                    | RPC: `terminal.open/attach/observe/write/resize/clear/restart/close` on the owning environment; streamed via `subscribeTerminalEvents`/`subscribeTerminalMetadata`; scope-gated (`terminal:read`, `terminal:operate`). Terminal excerpts become composer context records.                                                                                                                                                 | `packages/contracts/src/rpc.ts`, `apps/web/src/state/terminal.ts` → `packages/client-runtime/src/state/terminal.ts`, `apps/web/src/state/terminalSessions.ts`, `apps/web/src/components/chat/ComposerPendingTerminalContexts.tsx`; `docs/user/terminal.md`                                    |
| Commands / skills (`/`, `$`)                 | RPC. Listed from the _selected environment and provider_; provider commands must start a message, T3 commands work anywhere.                                                                                                                                                                                                                                                                                              | `docs/user/composer.md` "Commands and skills"; `apps/web/src/components/chat/ComposerCommandMenu.tsx`                                                                                                                                                                                         |
| Old / incompatible server                    | Same composer + banner and disabled control: `ComposerServerUpdateStatus.tsx` (with remote update via `server.updateServer*`), `supportsPullRequests`/`pullRequestsCapabilityKnown` gating, `serverUpdateRequired` on the catalog entry.                                                                                                                                                                                  | `apps/web/src/components/chat/ComposerServerUpdateStatus.tsx`, `packages/client-runtime/src/connection/catalog.ts:73`, `docs/internals/server-updates.md`                                                                                                                                     |

---

## 4. Thread creation across environments

A new thread never touches the network: it is a **local draft** with a client-minted
`ThreadId` and the environment chosen at creation time. `apps/web/src/hooks/useHandleNewThread.ts`
takes a `ScopedProjectRef` (which already carries `environmentId`), creates
`{ draftId, threadId }`, and navigates to `/draft/$draftId`. The draft's environment can change
**only while it is still unlocked**:

- `ChatView.tsx:3032-3055` derives `automaticEnvironment` (draft + no messages/runtime +
  `loadBalancingEnabled` + user hasn't picked a machine manually).
- `ChatView.tsx:4353-4460` = **Auto balance**: candidates are the _other_ environments that
  advertise the same logical project, are connected, have a positive weight, and have the
  selected provider installed/authenticated/available (`loadBalancingCandidates`). Choice is
  `packages/client-runtime/src/load-balancing.ts:6` `chooseLoadBalancedEnvironment` using each
  host's `HostResourcesSnapshot` (`server.getHostResources`) — CPU count/utilization and
  available memory, weight default 50, stale samples (>15 s) ignored. Refuses while the draft
  has attachments ("Keep attachments on this machine") because bytes are environment-bound.
- `ChatView.tsx:4451+` `onEnvironmentChange` = manual machine switch: retargets the draft's
  `projectRef` to that environment's project member, `environmentSelection: "manual"`. Scratch
  projects are machine-local, so switching also opens/creates the destination scratch project
  and the send stays disabled until it is ready. Guarded by `envLocked` (messages or a runtime
  already exist) and `sendInFlightRef` — _once a thread has a turn, it is pinned to that
  environment forever_ ("Existing threads stay where they started").

What changes at that moment (all re-read from the destination environment, no client catalog):
model/provider catalog (`serverConfig.providers`, per-project provider instance overrides),
branch and worktree lists (`vcs.listRefs` with that environment's `cwd` —
`apps/web/src/components/BranchToolbarBranchSelector.tsx:347`), directory browse
(`filesystem.browse`), project list (`orchestration.subscribeShell`/projects RPC), and the
earlier-mentioned capability flags. Projects are correlated across machines by _repository
identity_, not by path: `packages/client-runtime/src/state/projectGrouping.ts` groups by
`repositoryGroupingKeyOf(identity)` (`origin.canonicalKey ?? canonicalKey`) so the same repo on
two machines is one sidebar group with N members (`docs/internals/remote.md`, remote.md:11-18).

Send then dispatches `orchestration.launchThread` (or `dispatchCommand`) to the destination
environment; the draft promotes to `/$environmentId/$threadId` keeping the same `ChatView`
(`ThreadRouteView.tsx` comment: the route swap only changes props so the timeline never paints an
empty frame).

---

## 5. Reconnect / offline semantics that shape the composer

- **Snapshot over HTTP, then events over WS with a cursor.** Thread detail is fetched from
  `/api` (`packages/client-runtime/src/state/threadSnapshotHttp.ts`, 20 s deadline, socket
  fallback), and the live subscription resumes with
  `OrchestrationV2SubscribeThreadInput.afterSequence` — _"the server skips the initial snapshot
  frame and instead replays events after this sequence… overlapping events are deduped by
  sequence on the client"_ (`packages/contracts/src/orchestrationV2.ts:3352-3371`), plus
  `requestCompletionMarker` and `acceptBoundedSnapshot` for progressive history
  (`OrchestrationV2ThreadDetailSnapshot`, `:3374+`).
- **Subscription lifetime ≠ cache lifetime.** Mounted consumers share one live stream; it stops
  on the last unmount; a registry-local cache retains state **and the replay cursor for five
  idle minutes** so back navigation resumes without another snapshot
  (`docs/internals/connection-runtime.md`; `packages/client-runtime/src/state/threads.ts:131`
  `ThreadResumeCache`). Desktop additionally keep-alives every starting/running thread so
  opening it needs no replay (`apps/web/src/state/threads.ts`).
- **Transport vs data freshness are separate states.** "A socket opening is insufficient
  evidence that the environment is usable"; the RPC session waits for initial server config
  before ready, and a failed shell subscription is not "reconnecting"
  (`connection-runtime.md`). UI consumes this as `environmentUnavailable` (composer disabled,
  `DISCONNECTED_COMPOSER_PLACEHOLDER`) and `isConnecting`, plus a grace delay before a reconnect
  warning: `apps/web/src/components/ChatView.logic.ts:462`
  (`scheduleEnvironmentReconnectWarning`, `hasEnvironmentReconnectWarningGraceElapsed`).
- **Optimistic echo is local, reconciled by sequence.** `ChatView.tsx:1874`
  `optimisticUserMessages` renders the send immediately; each optimistic row retires once the
  projection contains the corresponding message/run (`ChatView.tsx:1757-1760`, `:6921`,
  `QueuedRunsControl.tsx:123-150` "Once the projection holds the message the optimistic copy is
  stale no more"). Attachments bind by the ids each side knows (`ChatView.tsx:9321`).
- **No offline send queue on web/desktop.** A send while disconnected is refused with a toast:
  "Not connected: message not sent" (`ChatView.tsx:8871-8882`). Drafts themselves are local and
  survive reload (`composerDraftStore.ts`, `localStorage` key `t3code:composer-drafts:v1`,
  schema version 9), but a file whose upload never finished hydrates as a _needs-reattach_ row
  (`composerDraftStore.ts:160-169`). Mobile is the exception: it keeps local copies of draft
  attachments and queued messages while disconnected and resumes uploads on reconnect
  (`docs/user/composer.md` "Queue messages offline on mobile"). Queued _messages_ (not drafts)
  are durable server-side and survive a server restart, held until **Resume**.
- **Reconnect does not replay mutations**; retry/idempotency belong to the operation
  (`connection-runtime.md` end), and commands carry `commandId` receipts so a retry is
  idempotent (`docs/internals/overview.md`).

---

## 6. What they deliberately did NOT reuse, and the reasons

1. **No proxying of UI or traffic.** The hosted app "stores its connection catalog in the browser
   and connects directly to each environment. It does not proxy traffic or hold server-side
   pairing state" (`docs/internals/remote.md:59-62`); "the relay Worker does not proxy their HTTP
   or WebSocket sessions" (`docs/internals/t3-connect.md:5-6`). Consequence stated in the same
   doc: hosting the UI over HTTPS cannot make a plain-HTTP LAN backend reachable from that
   browser context — they accept that limit rather than adding a relay data path.
2. **No iframe / embedded remote UI, no "server-rendered UI over the tunnel".** The desktop
   renderer is served from disk (`t3code://` scheme, Vite in dev) and API traffic always goes to
   the environment's own URL (`docs/internals/remote.md` "Desktop without a local environment").
   The client is one bundle talking RPC — not a shell around someone else's UI.
3. **No forked per-environment client or composer.** The only per-platform split is
   web/desktop (React) vs mobile (React Native) — `apps/mobile/src/features/threads/ThreadComposer.tsx`
   is a separate _renderer_, but it consumes the same `packages/client-runtime` state, the same
   contracts, the same RPCs, and the same dispatch policy (`state/composerDispatch.ts` says it is
   "Shared by web … and mobile … so both clients agree on what the user's configured follow-up
   behavior means"). Locality never forks anything.
4. **No local substitution of host state.** `docs/internals/overview.md:3-5`: _"A remote client
   must never substitute its own filesystem, provider credentials, or machine state for the
   environment's."_ Hence: file search hits the env, attachments upload to the env, model list is
   the env's, branches are the env's, terminals run on the env.
5. **No global "last selected environment" fallback.** "An unavailable target must not fall back
   to another environment" (`overview.md`, "Settings ownership"); removal clears that
   environment's credentials, projections and _drafts_
   (`packages/client-runtime/src/connection/registry.ts` `remove`), while an involuntary
   disconnect retains them.
6. **Retry, reconnect and cache are not per-view.** One supervisor per environment owns backoff
   (jittered exponential, 5-min cap) precisely to avoid "competing reconnect loops when several
   views need the same environment" (`connection-runtime.md`).

---

## 7. Files actually read (evidence list)

Docs

- `AGENTS.md` (glossary, "Hit every surface", "How it works", Taste: client mutations /
  `createEnvironmentRpcCommand` / `CLIENT_GUARDED_RPC_SCOPES` / `permissionAtom`)
- `README.md`, `docs/internals/{overview,web-ui,connection-runtime,remote,glossary,environment-auth,t3-connect,composer-context-references,composer-editors}.md`
- `docs/user/{composer,remote-access,permission-modes,terminal}.md`

Contracts

- `packages/contracts/src/{rpc,orchestrationV2,environment,auth,clientRpcPermissions}.ts`

Client runtime (shared by web + mobile)

- `packages/client-runtime/src/connection/{catalog,registry,supervisor,driver}.ts`
- `packages/client-runtime/src/rpc/{client,session}.ts`
- `packages/client-runtime/src/state/{runtime,threads,shell,server,attachments,filesystem,projects,terminal,terminalSession,composerDispatch,projectGrouping,threadSnapshotHttp}.ts`
- `packages/client-runtime/src/{load-balancing,text-paste}.ts`, `environment/scoped.ts`,
  `platform/persistence.ts`
- `packages/ssh/src/tunnel.ts` (`-L` forward)

Web

- `apps/web/src/routes/{_chat.$environmentId.$threadId,_chat.draft.$draftId,_chat.index,_chat.new}.tsx`,
  `apps/web/src/routes/_chat.tsx`
- `apps/web/src/components/ThreadRouteView.tsx`, `ChatView.tsx`, `ChatView.logic.ts`,
  `apps/web/src/components/chat/{ChatComposer,ComposerSurface,QueuedRunsControl,ComposerStale…,
ComposerPendingApprovalPanel,ComposerPendingUserInputPanel,ComposerServerUpdateStatus,
ComposerStashMenu,runtimeModeConfig}.tsx`, `composer/useComposerTriggerState.ts`
- `apps/web/src/state/{environments,session,query,server,shell,attachments,filesystem,projects,
terminal,terminalSessions,queries,entities}.ts`
- `apps/web/src/{threadRoutes,composerDraftStore,promptStashStore,logicalProject,
localEnvironment,hostedPairing}.ts`
- `apps/web/src/connection/{runtime,catalog}.ts`, `apps/web/src/environments/primary/{index,target}.ts`
- `apps/web/src/hooks/{useHandleNewThread,useLoadBalancedEnvironment}.ts`
- `apps/web/src/components/{BranchToolbarBranchSelector}.tsx`

Mobile (contrast only)

- `apps/mobile/src/features/threads/ThreadComposer.tsx` (imports `@t3tools/client-runtime/*`)

---

## 8. What we should copy (for `@dshfiles/multi-host`)

1. Promote "remote thread" to a first-class **environment-scoped thread** in DSH: one composer
   target that is `{ environmentId, threadId }` (plus a draft target carrying its environment),
   with every capability resolved from _that_ environment's session/attachments/filesystem/vcs
   surface, instead of a `remote` boolean that swaps in a plain textarea.
2. Give the Host a small **capability + scope handshake** the composer reads once per
   environment (`supportsAttachmentUploads`, `maxUploadBytes`, `supportsQuestions`, filesystem
   read, terminal operate), modeled like `ExecutionEnvironmentCapabilities` with optional keys so
   an older remote DSH degrades a _control_ with a reason, not the whole composer; enforce
   server-side anyway and treat the client flags as availability only.
3. Keep the composer's **data plumbing, not its rendering**, as the shared layer: one component
   with an atom/command family parameterized by environment, one reconnect/backoff owner per
   environment, one snapshot-then-`afterSequence` replay path with cursor dedupe, and optimistic
   echo retired by sequence — so reconnects and route changes never fork rendering.
4. Make new threads **environment-choosable while still a draft** (manual machine pick + optional
   load balancing over `HostResources`-style telemetry), and pin the thread to that environment
   the moment a turn exists; correlate projects across machines by repository identity so the
   same repo on another host is one sidebar group.
5. Do not proxy, iframe or fork the UI per host: keep one client bundle, one RPC boundary, and
   carry the destination in the route/ref. If a capability cannot cross the boundary, disable it
   in place and say why — never render a different, lesser composer.
6. Do not queue sends offline on desktop/web (refuse with a toast, keep the draft); make durable
   queued _turns_ and restart-held queues a server concept, and leave offline draft/attachment
   queues to the client surface that genuinely needs them.
