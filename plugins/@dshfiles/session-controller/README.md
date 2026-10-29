# @dshfiles/session-controller

![Send the browser only what a thread renders](docs/screenshots/lean-session-follow.png)

Owned fork of DSH's native Session controller row (Host commands, `session/follow`, history pages, and the browser
Session client). It keeps the native behaviour and changes what a thread costs to open (see Local delta): on the live
profile one Anthropic thread opened with a 26 MB snapshot, 17 MB of it thinking signatures the browser never reads.

## Upstream and license

- Upstream: [`deepseek-ai/deepseek-harness`](https://github.com/deepseek-ai/deepseek-harness)
- Package: `@deepseek-ai/dsh-api-session-controller@0.2.1-rc.2` (MIT, [LICENSE](./LICENSE))
- Pinned revision: tag `dsh-v0.2.1-rc.2`
- Vendored source: [`src/native`](./src/native) is upstream `packages/api/session-controller/src`; [`locale`](./locale)
  is upstream `locale`.
- Typert: `pnpm build` derives [`typert/host.js`](./typert) from the installed stock `lib/typert.host.js`
  ([`scripts/derive-typert.mjs`](./scripts/derive-typert.mjs)), changing the manifest's package name (the Typert loader
  requires it to equal this package's name) and adding the fork's optional list-selector field to both request codecs.

### Why a whole-package fork

`session/follow`, history paging and the browser's opening window live inside this package's Host controller and
Session client; no Slot, service or setting reaches them. This package replaces the `session-controller` Loader row:
its `cordis.patch.yml` disables `session-controller` and inserts `dshfiles-session-controller`. Native rows that
declare `dsh.client.inject` on the stock package keep loading: the browser module table still serves the stock
`/client` module, and `ctx.sessions` comes from this row.

### Thread-local model selection

The published `thread-model-api` dshx module adds `snapshot` and `select` for local model intent. Unlike ordinary native `selectModel`, the guarded selection does not save a global default, enqueue input or wake a stopped Agent. It validates the advertised model and effort, then rechecks queued input and the expected model revision inside native serialized admission before synchronously appending selection plus a supported namespaced plugin-record annotation. Archived and runtime-owned subagent targets are refused, including persisted cold subagents. Reading a cold snapshot does not create an Agent.

The `threadModelPolicy` projection retains explicit provider preference across request headers and replay/fork checkpoints. Only an annotation immediately adjacent to the exact native selection can grant it; ordinary picker/automatic recovery selections clear it. It accepts native model identifiers without imposing a shorter UI limit. The public Agent tools are `thread_local_model_state` and `thread_select_local_model`; Agent callers are self-only, and client/Host callers must explicitly identify the thread. Writes require a user request.

AI Accounts consumes this contract for its sidebar handoff. Its request-policy capture follows native `system-prompt/assemble` timing, and automatic follow/restore writes use commit-time revision checks so a late old request cannot overwrite newer user intent. Live in-flight requests retain their assembled selection; following requests use the new one. The original native picker still persists deployment defaults as before.

The dshx exact Fetch carrier is owner-only in pinned DSH0.2.1-rc.2. Native `remoteAccess.allows` outside a native Remote invocation is not an independent HTTP authorization check; preserve the carrier restriction and Agent self-scope when adding transports.

### Local delta

Every other vendored file is byte-identical to the pinned revision.

| File                                                       | Change                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/native/history.ts`                                    | `entryFor` sends `BrowserEvent.of(event)`: history pages and live follow events reach the browser without per-block provider replay state; opening a cold Session resumes its Agent only when the log stops inside a turn (crash closers), otherwise the first command does                                                                                                                                                                                                           |
| [src/native/index.ts](./src/native/index.ts)               | Registers guarded local model-policy read/select methods and the durable preference projection; `modelCatalog` delegates to the coherent shared catalog below (a page load asked 12 times, up to 2.7 s each); `list` passes the request's projection selector to the row builder; `list`, `follow`, `page`, `prompt`, `cancel`, `updateQueue` and `projections` first offer the request to a registered Session source (see below) and keep their own implementation as the fallback. |
| [src/native/catalog.ts](./src/native/catalog.ts)           | Owns catalog construction and one `SessionModelCatalog` wrapper; adapter, settings and credential updates synchronously invalidate its single shared build coordinator without eagerly reading partially committed routes.                                                                                                                                                                                                                                                            |
| [src/model-catalog-build.ts](./src/model-catalog-build.ts) | Shares pending builds across TTL intervals, reuses completed snapshots for 5 s while the default and input generation match, and forwards obsolete completions or failures to the latest generation.                                                                                                                                                                                                                                                                                  |
| [src/native/commands.ts](./src/native/commands.ts)         | Shares supported model validation; local selection rechecks revision, archive/subagent ownership and queued input at the serialized commit, without saving the global default. Ordinary native selection retains its existing default-save behavior.                                                                                                                                                                                                                                  |
| `src/native/types.ts`                                      | `SessionListRequest.projections` is an optional allowlist: omitted reads every column, `[]` reads none, unknown keys are ignored                                                                                                                                                                                                                                                                                                                                                      |
| `src/native/client/sessions/manager.ts`                    | the list pull asks for the eight columns the list surface consumes, falling back to the full request when an older Host rejects the unknown field                                                                                                                                                                                                                                                                                                                                     |
| `src/tail-log.ts`                                          | new: decodes only the last frames of a cold Session's zstd log and folds the cached projection checkpoint over them (`sessionProjections.restore`); `follow` opens a cold, unforked Session over 1 MB from it and `page` serves its older pages from the same kept tail (3 kept, 2 min, re-validated by file identity); live, forked, torn, migrating or mid-turn logs keep the full read. `paginate` takes the tail's base seq                                                       |
| `src/browser-event.ts`                                     | new: drops `replayState.blocks` from `assistant/message` and `assistant/attempt` (message source and stream chunks), keeps `replayState.response` (ids, native stop reason)                                                                                                                                                                                                                                                                                                           |
| `src/native/client/sessions/session.ts`                    | a thread opens with `OPENING_PAGE_OPTIONS` (latest Turn, 20–120 messages) instead of the 50-message, two-Turn, 500-cap window; older pages keep the native window                                                                                                                                                                                                                                                                                                                     |
| `src/native/list.ts`                                       | cold rows keep their full projection column per Session id until that Session attaches, appends or detaches; every `session/list` used to re-read each cold Session log's compressed prefix (Host gap 70). The optional projection selector narrows each read to the caller's columns, still reads `sessionListMetadata` for `blank`/`updatedAt`, and never memoizes a filtered cold read                                                                                             |
| `src/native/client/index.ts`                               | typing only: no duplicate `Context.sessions` augmentation (the stock one reaches every dshx client program), and the connection cast goes through `unknown` (dshx types see Host types)                                                                                                                                                                                                                                                                                               |
| `src/host.ts`, `src/client-entry.tsx`                      | new: dshx entries calling the native plugin                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/mime-types.d.ts`                                      | new: the one `mime-types` call's type; upstream gets it from its workspace                                                                                                                                                                                                                                                                                                                                                                                                            |

`interruption-api` serves availability and resume for Chat's latest interrupted
turn (a Host exit, or a model request that failed after its retries; not a user
stop or a signed-out account), including the `chat_resume_interrupted` agent tool. Prompt admission checks
the expected ending sequence, idle status, and empty inbox after asynchronous
attachment validation, immediately before delivery. Intervening work invalidates
the action; a deterministic request id makes retries idempotent. A message that
arrived after the interruption but never started a turn does not invalidate it:
a restart can persist the message and leave no turn to run it, so the stopped
task still offers Resume.

### Driving threads: `sessions-api`

The published `sessions-api` dshx module (`sessionsApi`, owner `@dshfiles/session-controller`) is the typed way for
another plugin (`createHostApiClient`) or a browser (`useApi`) to drive a thread. Every method runs the same native
path as the Chat UI; native refusals keep their message with a `session-*` code.

```ts
const sessions = createHostApiClient(ctx, sessionsApi, '@acme/plugin')
const { sessionId } = await sessions.create({ projectId, title: 'Nightly triage', model: { provider, model }, prompt: 'Triage the new issues.' })
await sessions.setInstruction({ sessionId, key: '@acme/plugin:tone', text: 'Answer in French.' }) // text: null removes it
await sessions.message({ sessionId, text: 'CI finished: 2 failures.', wake: true })
await sessions.wait({ sessionId, timeoutMs: 120_000 }) // { status: 'idle' | 'running' }
await sessions.compact({ sessionId }) // or command({ sessionId, line: '/goal …' })
const { value } = await sessions.generate({ prompt, jsonSchema: { type: 'object', properties: { title: { type: 'string' } } } })
```

| Method                           | What                                                                                                                                                      |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create`                         | thread in a project or directory, with optional agent preset, title, model and first prompt                                                               |
| `prompt`                         | user prompt, `queue` (default) or `steer`                                                                                                                 |
| `command`                        | one slash command line, as typed in the composer                                                                                                          |
| `message`                        | a message recorded with the calling plugin as its source (`dshfiles-plugin-message`); `next-turn` or `next-step`, `wake` to start an idle thread          |
| `compact`, `interrupt`           | `/compact`; stop the running turn, keeping the queue                                                                                                      |
| `wait`                           | until idle with nothing queued, or `timeoutMs`                                                                                                            |
| `selectModel`, `selectAgent`     | the thread's model; its agent preset                                                                                                                      |
| `instructions`, `setInstruction` | keyed instructions every later request carries in its system prompt (a section, so a removed one leaves no trace in history), kept in dshx plugin storage |
| `generate`                       | dshx `generate` for Clients: one model call outside any thread, `jsonSchema` for JSON output                                                              |

None of these is an agent tool: what the agent may do to other threads is thread-sidebar's thread tools, which now
call this API for create, prompt, stop and model selection.

### Live model catalog

The Host cache listens to the same inputs as the native model picker: `llm/adapters-updated`,
`settings/document-updated`, `credentials/record-updated` and `credentials/reference-updated`.
Invalidation is lazy. A credential/settings notification may precede publication of an account route;
the later adapter commit invalidates any intervening read again. The single coordinator shares pending builds
even across TTL intervals and reuses completed snapshots for five seconds after completion. A read or failure
from an obsolete input/default generation forwards to the latest build, so already-waiting readers cannot
receive a pre-commit catalog. This preserves coalescing without hiding a newly connected, renamed or removed
provider until a reload.

[Catalog regressions](./tests/host/model-catalog-cache.test.ts) use the installed `LlmRuntime` and real adapter
registration/replacement, including same-id catalog changes and a stale in-flight read settling after commit.
Run `./node_modules/.bin/vitest run tests/host/model-catalog-cache.test.ts` from this package.

### Local unsent drafts

The public `@dshfiles/session-controller/draft-client` dshx module owns `ctx.sessionDrafts`:

- `list`: observable identity/workspace/preview metadata plus `local`, staged `model` and `agentPreset`;
  empty local blanks have `preview: ''`.
- `create({ workspaceId, cwd, agentPreset? })`: allocates a fresh retainable local identity, with no Host call.
- `update(id, { text, hasAttachments })`: stores bounded preview metadata before the first nonempty update
  materializes the Host Session. The composer alone owns full text and attachments in its existing conversation store.
- `stageModel(id, selection)` / `stagePreset(id, preset)`: consume local choices without a Host RPC;
  return false for an already-materialized Session so controls retain their native mutation path. Empty choices
  stay in memory only. The latest choices drain after creation and before history, warmup or first-send readiness.
- `whenCreated(id, signal?)`: waits without activating an empty blank; abort cancels only this waiter.
- `retry(id)`: retries failed materialization; sending again also retries. Failure keeps the identity, metadata,
  and composer buffer, and appears in the Session error snapshot.

Only typed/attachment draft metadata is persisted (`dsh.sessionDrafts`). It survives creation failure and reload;
Host-derived nonblank evidence retires it, independently of the hero's existing `blank` presentation.
Writes re-read browser storage, merge only changed identities, and remove only explicitly cleared/retired identities,
so independent tabs do not replace each other's draft lists. Rejected writes preserve the in-memory draft and pending
metadata changes and show a Session warning; a later edit retries the write.
Local history/follow, projections and Session mutation methods never address an uncreated identity.
A local `mainView`/`sidebarView` reference is synchronously binding-ready; its Session stays `cold` until
materialization enables background history. Other operation references keep real-history readiness.
`using()` waits for local creation before acquiring a reference, so speculative command-catalog warmup cannot
keep an abandoned empty view alive; caller cancellation and Controller disposal cancel that unretained wait.
`ctx.sessions.create` and `createOptimistic` retain their native real-creation semantics for agent and JJ flows.

Before retrying a submitted draft, the composer re-admits its captured outgoing text/attachment presence through
`update`. Attachment-only sends and asynchronous reference serialization can clear the editor before the sink runs;
using the now-empty editor snapshot would prevent retry. This admission updates bounded discovery metadata, not the
editor or another text buffer. Regression tests cover real composer clear ordering and owner recovery without
creating a second Host identity after a selection failure.

The cohesive project-header and typed-draft lifecycle was accepted in [upstream PR #1](https://github.com/astahmer/dshfiles/pull/1).
Both native model/preset companions are required alongside the updated controller, navigation, composer and sidebar;
profile activation is a coordinated, user-controlled restart rather than an arbitrary mix of old/new clients.

### Session sources (remote Sessions)

`src/mirrored-sessions.ts` (new, not vendored) lets another plugin register Sessions this Host does not own — today
`@dshfiles/multi-host` registers the Sessions of every reachable remote runtime. The contract is
[`@dshfiles/session-source-port`](../session-source-port): one source mirrors the `session/*` endpoints it implements,
so `session/list` merges its rows into this Host's list, and `follow`, `page`, `prompt`, `cancel`, `updateQueue` and
`projections` forward the caller's request unchanged to the runtime that owns the Session. A Session this Host has
attached always stays local, a source that cannot answer falls back to the local implementation, and one unreachable
runtime never hides this Host's own threads. Newly listed rows are published as `api-session/added` (and a changed
running state as `api-session/status`), so an open browser adds the thread without waiting for its next pull.

### Build

`tsconfig.host.json` compiles the Host side with tsc into `build/host` first: the dshx bundler keeps TC39 `@Remote`
decorators as written, and Node rejects them; upstream's build compiles with tsc too. `dshx build` then bundles
`build/host/host.js`. The client inlines what the native client chunk inlines and loads `@deepseek-ai/cordis`,
`@deepseek-ai/dsh-api-gateway/client` and `@deepseek-ai/dsh-client-store` from the module table, as the native build
does. `pnpm typecheck` runs the client program and the Host program with its tests (`tests/host`).

`src/host.ts` is the fork's entry shim and must import the vendored native entry `src/native/index.ts`, so the lint and
format configs exclude it with `src/native/**`.

### Updating upstream

1. `node scripts/native-fork-diff.mjs session-controller --to <new-tag>` lists what upstream changed between the pinned tag and
   the new one, and which of those files carry a local delta.
2. Copy the new `src` over `src/native`, re-apply the delta table, and bump the pinned version here and in
   [docs/native-forks.md](../../../docs/native-forks.md).
3. `pnpm build && pnpm typecheck && pnpm test`, then `node scripts/check-browser.mjs boot session-controller` and the
   composer and sidebar journeys.
