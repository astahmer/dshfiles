# Remote threads and the composer

Why a remote thread cannot use this machine's composer as it stands, how bb, t3code
and Codex give remote work the full composer instead of a reduced one, and the two
DSH-shaped routes we can take. Behavior of the current remote view is in the
[README](../README.md); why runtimes are federated is in [design.md](design.md).

Researched 2026-10-21 against DSH 0.2.1-rc.2.

## The problem

The original New thread bar replaced this machine's composer with a plain card while
a host was chosen (`RemoteComposer`): a textarea, a flat model dropdown and a send
button. That reduced composer has been removed. A remote thread now opens as an empty
mirrored Session in the native chat and composer. The model catalog and reasoning
effort, file uploads, and `@` file references route to the owning remote runtime.

The composer is not a component that inherently talks to any target; it is a view of
a Session's input machine. `session-controller` now routes model selection for
mirrored Sessions through their source, and rich-composer resolves the Session owner
before forwarding upload. Session-owned file reference lookup likewise checks the
remote runtime identity before contacting its file-reference service.

## What the composer is actually made of

`conversation.composer.bar` is owned by our `rich-composer` fork, but the bar is only
the shell. Its inputs come from the Session scope and from ten other client plugins:

| Capability                                    | Owner                                                     | Data source                              |
| --------------------------------------------- | --------------------------------------------------------- | ---------------------------------------- |
| Text surface, `/` commands, send/steer policy | `rich-composer` (`input/facade.ts`, Lexical editor)       | `ctx.conversation.input.for(session)`    |
| Running/removed/blank, prompt errors, queue   | `rich-composer` + `session-controller` client             | `session/follow` of **this** runtime     |
| Model + reasoning effort                      | `model-effort-picker` on `conversation.input.model`       | local model catalog and settings         |
| `@` file/session references                   | `mentions` + `command-palette`                            | local workspace files and session search |
| Prompt snippets                               | `prompt-stash`                                            | browser storage                          |
| Image/file attachments                        | `attachment-gallery` + `send-after-upload`                | local file upload receipts               |
| Queue dock, todo, plan, permission            | `queue-reorder`, `jujutsu`, `home`, `btw`, plan/perm rows | session projections of this runtime      |
| jj / project chips under the composer         | `jujutsu`, `jj-integration`                               | local filesystem and `jj`                |

No DSH contract carries "which runtime" alongside a Session. `session/create` takes
`workspaceId`, `cwd` and `agentPreset`; the browser client binds to one runtime at
boot, and the fork's own design notes record this as the open question
"rendering a remote Session natively needs isolated client contexts"
([design.md](design.md#open-questions), upstream gap [#9077](https://github.com/deepseek-ai/deepseek-harness/discussions/9077)).

So there are only three honest shapes:

1. a second client that is bound to the host (embed it),
2. give this client's data plane an environment dimension (bb/t3code/Codex shape),
3. port the missing capabilities into a bespoke remote composer, forever.

## How the products that solved this did it

All three keep **one** composer and give its data plane a target; none of them ships
a reduced composer for remote work.

### bb (`get-bb/bb`, app source read from the extracted app asar)

bb is a **server plus per-machine host daemons**: the app talks to one server API
whose queries already carry the host as a dimension (`hostId` + `environmentId` in
`systemProvidersQuery`, `systemExecutionOptionsQuery`,
`packages/server-contract/src/api/hosts.ts`), and the server relays path, process
and provider capabilities to the chosen daemon (`packages/host-daemon-contract`).
Repository browsing is a `hostDirectory` query on the chosen host, not a local walk
(`packages/server-contract/src/api/hosts.ts`).

The composer is **one component for every thread**: `PromptBoxInternal` behind both
`NewThreadPromptBox` (with an `EnvironmentPicker`) and `FollowUpPromptBox` (same
component, no picker), and attachments upload through the server to the thread's
host (`apps/app/src/hooks/mutations/project-mutations.ts` behind
`useComposerAttachmentUploads`). Only the environment of the thread differs.

This is the closest shape to DSH: **one browser-to-Host boundary, the aggregator
holds the host dimension, remote capabilities are reached through it.**

### t3code (`.references/t3code`)

"The environment owns providers, execution, files and durable state"; the client is
a static SPA whose API traffic goes to **the thread's own environment**
(`docs/internals/remote.md` of the T3 Code checkout). One connection
runtime per environment is shared by web, desktop and mobile
(`docs/internals/connection-runtime.md`),
uploads go to that environment's machine, and queued messages are saved there
(`docs/user/composer.md`). A thread is
`{environmentId, threadId}` and the environment is picked on the draft, then pinned
on the first turn; capability flags — not locality — disable an individual control
with a stated reason. It deliberately keeps **no** proxy, iframe or per-host fork:
one client bundle, direct to each environment.

### Codex

Codex ships one `ComposerInput` and reuses it for cloud tasks — its own doc says it
exists so other crates "can reuse the mature composer behavior" — while the desktop
composer offers a `Work in: This computer | Cloud` menu. A remote **host** is reached
by starting `codex app-server` there over SSH and speaking the identical JSON-RPC
("the same `AppServerEvent` surface for both in-process and remote transports"), and
a remote **environment** is attached per thread/turn as
`ThreadEnvironment { environmentId, cwd, workspaceRoots }`. Its queues and steer
channel live server-side, and on a dropped connection Codex keeps the rich composer
and restricts _submission_ (`RestrictedInputMode::Disconnected`) instead of swapping
in a plain input.

The lesson is consistent: **a remote thread is a thread whose data plane is another
machine, not a thread with a different composer.** The two proven implementations
are "one aggregator with a host dimension" (bb) and "the client talks to each
environment directly" (t3code/Codex); DSH's one-browser-to-one-Host architecture
maps to bb's.

Full notes, with the files and URLs read for each product, are in
[docs/research/remote-thread-composer](../../../../docs/research/remote-thread-composer/).

## Lessons we adopt

1. **The target is argument data, never a mode that swaps the UI.** A thread (and a
   draft) carries the runtime it belongs to; every session-scoped request can name it.
2. **One aggregator fans out.** The browser talks to one Host; that Host routes typed
   calls to the remote runtime. That is bb's server-to-daemon bus and already
   multi-host's shape (`src/connectors/gateway.ts`).
3. **Capabilities, not locality, disable a control** — with a stated reason, at the
   control. "This host cannot search files" is a disabled `@` menu, not a missing
   composer.
4. **Durables stay on the owning side.** Drafts are client-local, queues/interactions
   are Host-side, and attachments are uploaded through the aggregator, bound to the
   runtime they were uploaded to (re-upload if the target changes).
5. **A dropped connection restricts submission; it never replaces the composer.** The
   native composer remains in place and retains its draft when remote calls fail.
6. **Strict machine-local paths.** A local attachment is uploaded through the
   owning-runtime API; it is not passed as a local filesystem path. Cross-machine
   absolute-path refusal messaging remains unverified.

## What DSH already gives us

Our own forks are the levers, and multi-host's Host half already speaks the remote
runtime's gateway:

- `@dshfiles/session-controller` vendors the whole package, Host **and** browser
  client: `SessionController` with `@Remote` `list`, `prompt`, `cancel`, `updateQueue`,
  `page`, `copy`, `projections`, plus the `session/follow` and `session/control`
  streams, and the browser `sessions` manager under it.
- `@dshfiles/chat` and `@dshfiles/rich-composer` are whole-package forks that render
  a Session from that client service only.
- multi-host's Host already connects to a remote runtime's `/api` for unary calls and
  opens its `/api/remote.mux` WebSocket for `session/follow`
  (`src/connectors/gateway.ts`, `follow()`), and forwards prompts and cancels today.

So the missing piece was **not a composer**: it was a session source that answers
the existing client's `session/*` calls for a remote Session. That mirror now routes
model selection as well; the rich-composer upload and file-reference paths resolve
the owning runtime before forwarding.

## The three routes

| Route                                                                                 | Composer parity               | Local plugins on remote threads (jj chips, backlog, memory) | New UI to maintain | Work                                                                                                                    |
| ------------------------------------------------------------------------------------- | ----------------------------- | ----------------------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------------------------------------- |
| **A. Embed the host's own client** in the remote panel                                | 100%, forever                 | No: the host's own plugins act                              | none               | small: iframe on the stable loopback origin + `?thread=` consumer + embed chrome hide; probed working (token→cookie→UI) |
| **B. Port capabilities into the local remote composer**                               | partial, per feature          | Yes, for the ported ones                                    | a second composer  | each feature needs a remote endpoint; never converges                                                                   |
| **C. Give the data plane an environment dimension** (this is what bb/t3code/Codex do) | 100% (native composer + chat) | Yes, once path services are proxied                         | none               | large: session source for remote Sessions, then models/uploads/mentions; approvals stay host-side until waterfall proxy |

C splits into two implementations, and one of them is much cheaper here:

- **C1, client multi-runtime** (t3code's shape): fork `client-connection` and
  `api-gateway` client so a second gateway can be mounted, then route per Session.
  Deep infrastructure forks, and every client package keeps assuming one runtime.
- **C2, Host mirror** (bb's shape): the local Host presents remote Sessions as its
  own — `session/list` adds them, `session/follow`/`page` re-serve the remote frames
  verbatim (same wire contract), `prompt`/`cancel`/`updateQueue` and model selection
  forward, and the model catalog, uploads and file references come from that runtime.
  The native composer and chat render the remote thread. A minimal read-only `sessionJjRepositories(sessionId)` proxy resolves the owning runtime and reads its repository/workspace status without sending a path. Path-scoped JJ operations, approval answers and terminal access remain on the host UI.

`session/follow` frames are the same JSON events on both sides (same DSH version),
which is what makes C2 tractable at all: the mirror re-emits, it does not translate.

## Recommendation

1. **Do not build a second composer** (B as the plan). It is the route that
   guarantees permanent drift; none of the three products took it, and Codex's
   disconnect rule shows the composer is the part you keep. B is only a source of
   short-term relief for one control at a time.
2. **Take C2, bb's shape.** The browser stays on one Host; that Host owns the runtime
   dimension and routes a mirrored Session's calls to the remote runtime. Begin with
   the smallest reversible slice: multi-host Host registers mirrored Sessions
   (read-only first: `session/list` + `follow` + `page`), so a remote thread opens in
   the native conversation with its real transcript, then `prompt` (the native
   composer sends to the host), then the model catalog, then uploads and `@`
   references, then queue edit and approvals. Each landed slice deletes a line from
   `RemoteComposer`/`RemoteThreadView`; the bespoke view shrinks to nothing.
3. Keep **A** as the escape hatch for what C2 cannot reach: `Host UI` already opens
   the host's client in a tab, and an embedded option stays useful for approvals and
   terminals until the waterfall proxy exists.

The slice order matters: steps 1–2 are read-only and cannot corrupt a remote thread,
and step 3 is the one that removes the plain textarea the owner complained about.

Stop conditions, recorded up front: if mirrored Sessions cannot be made to answer
`session/follow` with the same event shapes (version skew between machines), or the
client's per-session model/upload services cannot be pointed at a remote runtime
without forking those client packages too, C2 collapses back to A and the gap is
recorded in [plans/dsh-host-gaps.md](../../../../plans/dsh-host-gaps.md).

## Current implementation

A remote Session is listed, followed, paged, prompted, cancelled, queue-edited and
model-selected through this Host. It opens in native chat and composer; the reduced
remote composer is gone. The seam is
[`@dshfiles/session-source-port`](../../session-source-port) (mirror endpoints per
source), provided by this fork's `MirroredSessions` and filled by multi-host's
`remote-session-source.ts`. The model picker reads the remote catalog and reasoning
efforts, uploads are staged on the owning Host, and `@` file references are listed
from that runtime with Session ownership checked before forwarding. Drafts stay in the
client; questions/approvals and terminal interactions still require the host UI.

Validation: `DSHX_E2E_ONLY=@dshfiles/multi-host node --run check:e2e` covers remote
Session creation, file-reference results, and a file upload over loopback SSH. Focused
unit tests cover Session ownership authorization and mirrored model selection. Direct
browser interaction with model selection and the file picker, plus cross-machine
absolute-path refusal messaging, remain unverified.

## Remaining boundaries

- `sessionJjRepositories(sessionId)` is read-only status, not a local JJ panel. Per-thread path-scoped JJ reads, workspace mutations and landing are not mirrored; the native thread still offers Host UI.
- In-client question/approval answers and terminal access are not mirrored. The remote waterfall payload/answer RPC is only delivered to the owner Host's client. The local transcript's open tool-call name is not sufficient authorization to fabricate an answer or approve a call; Host UI is the safe fallback.
- The loopback SSH E2E tests Host API transport for remote file references and uploads,
  but does not drive the browser's model picker or attachment picker.
- The implementation routes selected local files through the owning runtime's upload
  service. A specific cross-machine absolute-path refusal message has not been
  implemented or tested.
