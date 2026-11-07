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
   owning-runtime API; it is not passed as a local filesystem path. A message that
   names this machine is refused before it reaches the owner (see
   [Cross-machine references](#cross-machine-references)).

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
| **C. Give the data plane an environment dimension** (this is what bb/t3code/Codex do) | 100% (native composer + chat) | Yes, once path services are proxied                         | none               | large: session source for remote Sessions, then models/uploads/mentions, then the owner's event stream                |

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
Session creation, file-reference results, a file upload over loopback SSH, and the
browser's model picker and file picker on a remote thread (`multi-host.auto-destination`).
Focused unit tests cover Session ownership authorization, mirrored model selection and
the cross-machine refusals below.

## Cross-machine references

A path in a message is text: nothing reads it until the remote agent or its `@` resolver
looks it up there, so a path from this machine fails or silently names another file.
`remote-prompt-guard.ts` applies the rule the owner chose on 2026-11-07 to every message
the Session source forwards (`prompt`, a queued edit) and to `threadReply`/`threadStart`:

| Message on a remote thread                                         | Result  |
| ------------------------------------------------------------------ | ------- |
| `@~/x`, or `@/abs/path` under this Host's home                     | refused |
| `@relative/path`, or `@/abs/path` inside the thread's folder       | sent    |
| `@/abs/path` anywhere else, such as `@/etc/hosts`                  | sent    |
| a path in plain prose, such as a stack trace                       | sent    |
| an upload this Host staged for another thread or runtime           | refused |
| an upload this Host has no record of                               | sent; the owner decides |

Two machines can share a home path, so the thread's folder wins over the home. The
upload ledger is in memory: after a local restart a receipt is unknown rather than
foreign, and it goes to the owner, whose `session/attachment-invalid` becomes the same
recovery message. The refusal is `SessionPromptRefused`, which the Session controller shows
as written (`session-source-port`), and the composer keeps the draft.

## Questions

The owning runtime forwards `user-questions/request` as a waterfall to any owner client
of its gateway, so this Host becomes one (`remote-interactions.ts`). A runtime's launch
cookie authenticates as its owner browser peer, which may answer forwarded events: while
a mirrored Session is followed, the Host opens that runtime's `$events` stream on the
`/api/remote.mux` socket and holds each request, and an answer goes back as
`$events/result` over the same peer.

The owner stays the authority. It accepts a result only for a request it delivered to
that client, and this Host also checks that the request belongs to the Session and that
the Session controller agrees which runtime owns it. Nothing is fabricated from a
transcript, and nothing answers `next`: delegation would tell the owner no client wants
the request, while holding it leaves it for the owner's own UI. A dropped stream forgets
what it held and the owner delivers it again on the next one.

A timed question claims the owner's wait through `userQuestions/attachWait`, as the
native client does, and only then reaches a card: a card that mounts without a deadline
takes focus, and focus freezes a countdown that has not started. A runtime that refuses
the claim keeps its own timer, and its `cancel` frame ends the card.

Being an owner client has two effects on the owner worth knowing. A client that holds a
timed question counts down as a second browser would, so its timeout continues the agent
even while someone takes their time at the host; the question stays answerable. And
`hasLiveClient` is true while the bridge is open, which only changes how the owner reports
a `dsh inspect` query with no page attached.

`sessionInteractions` is what keeps these streams open for threads that are not open
here: a browser's feed reads it at least every 15 seconds, and each read marks every
visible runtime with recorded threads as watched for the next 45 seconds. Held requests
publish through the same pending-interaction channel as local ones, so the thread list's
**Needs you** group needs no multi-host code. Nothing is watched with no browser reading,
and a stream that keeps failing retries at a doubling delay up to a minute.

A question that outlived its wait is `continued`, and it comes from the `userQuestions`
projection. Live projection values travel on `session/control`, which serves one Host's
own Sessions, so the bridge also follows the runtime's control stream and hands each
value to the Session controller through `SessionSourceRegistry.publishProjection`. This
is also what keeps a mirrored thread's other live values, such as its inbox, current
after the opening snapshot.

## Approvals

`approval/request` arrives on the same stream and is held the same way. The native panel
is private to `@deepseek-ai/dsh-client-ui-approval` (its selector tests a private class),
so `remote-approval-panel.tsx` is a small owned panel in the same composer seat, with the
native keys and one lock across keys and pointer. The decision goes to the owner as that
waterfall's result, and the owner writes the `approval/decided` audit event.

`sessionApprovalDecide` deliberately has no agent tool: an approval is the human's, and
[row 41](../../../../plans/dsh-host-gaps.md) keeps it out of reach of any Agent. It is an
exception to the rule that a user capability carries a tool, stated here so nobody adds one.

## JJ actions

A mirrored thread's folder means nothing on this machine, so `threadAt` here could only
answer "not a thread". `sessionThreadApi` in jj-integration resolves the Session's owner
once and sends the thread control's four calls to it through `sessionJjCall`; a local
Session keeps this Host's API unchanged. The owner's refusal code survives, so a queued
integration is recognized the same way on both sides.

The side panel and the composer's changes bar go further through `sessionRepositoryCall`:
`OwnerRouting.api` gives them a client of the same shape whose calls reach the owner, so
no component changed beyond which client it asks for. The owner mints a new repository id
per registration, so the Host cannot compare with one id: it remembers the ids returned
for this thread's folder and accepts only those. An id from before a Host restart is
refused, and reopening the panel registers a new one. A workspace added from the panel may
only sit beside the thread's folder.

The Host authorizes the Session as usual, then `RemoteJjScope` requires the action's path
to be that thread's own folder: owning a Session is not a grant over the machine, so an
agent or a stale client cannot name another workspace. `discard` keeps its required
`force`, and the runtime still applies every eligibility check of its own.

The Land page merges `remoteRepositories` into its own list. That read asks each runtime
to rescan first, because `repositories` answers from the last scan, and it matches
workspaces to recorded threads by folder, because an owner may list no Session against a
workspace. Only those threads appear: anything else on that machine has no Session to
authorize an action. Each row's land and remove go through one of its Sessions, so they
pass the same owner and folder checks as the thread control.

## Fork and rename

A mirrored Session's log lives on its owner, so `session/fork` and `session/rename` go there
too. A fork stays on that host and is recorded here as one of its threads, so it opens in
this client like any other.

## Remaining boundaries

- Terminal access is not mirrored; Host UI is the fallback.
