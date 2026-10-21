# Remote threads as real threads

A thread that runs on another machine should open in **this** client: the native
conversation, the native composer, and the local plugins that already act on a
thread. Today multi-host substitutes a polled transcript and a plain textarea for a
remote thread; the owner's complaint on 2026-10-21 ("cant we just re-use the one from
the usual thread composer") is the symptom.

Investigation, the three product models, and why the composer cannot simply be
reused: [remote-thread-architecture.md](../../plugins/@dshfiles/multi-host/docs/remote-thread-architecture.md).
Research notes: [docs/research/remote-thread-composer](../../docs/research/remote-thread-composer/).

## Decision (2026-10-21)

Take **bb's shape**: the browser keeps talking to one Host, and that Host gains a
runtime dimension and routes a mirrored Session's calls to the runtime that owns it.
No second composer, no per-host client fork, no embedded iframe as the product.

- The lever is [`@dshfiles/session-controller`](../../plugins/@dshfiles/session-controller),
  already a whole-package fork of the native controller (Host `@Remote` surface and
  browser client).
- The transport is [`@dshfiles/multi-host`](../../plugins/@dshfiles/multi-host)'s
  Host half, which already opens the remote runtime's `/api` and `/api/remote.mux`.
- The wire frames of `session/follow` are the same JSON on both sides, so the mirror
  re-emits; it does not translate.

Rejected as the plan, kept as sources of small fixes:

- **B, a bespoke remote composer**: permanent drift, and none of bb/t3code/Codex took
  it.
- **A, embedding the host's client as the product**: full parity for free, but the
  local plugins cannot act on the thread. `Host UI` and an optional embedded view stay
  as the escape hatch for approvals and terminals.

## Architecture

```
browser (unchanged) ── one gateway ── local Host ──┬── local runtime (files, agents)
                                                  └── multi-host router ── SSH tunnel ── remote DSH gateway
```

- `session/list` gains mirrored rows: `{ runtimeId, sessionId, cwd, title, updatedAt,
running }`, marked so the UI can badge them.
- `session/follow` / `session/page` re-serve the remote journal frames for a mirrored
  session; `prompt` / `cancel` / `updateQueue` forward to that runtime.
- Model catalog, uploads, and file references resolve from the owning runtime
  (capability-gated: a control that cannot cross is disabled with a reason).
- Drafts stay client-local; queues and pending interactions stay on the Host that
  owns the turn; attachments upload through the router and are bound to the runtime
  they were uploaded to (re-upload when the target changes).
- A disconnected runtime restricts submission and keeps the composer; it never swaps
  in a reduced input.

## Milestones

| #   | Slice                                                                                       | Acceptance                                                                                                        | Status |
| --- | ------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------ |
| 1   | Mirror store + `session/list` rows for threads started here and threads started on the host | the sidebar and main panel show a remote thread as a thread, badged with its runtime                              | done   |
| 2   | `session/follow` + `session/page` re-served from the remote journal stream                  | native chat renders the live transcript: user text, assistant blocks, tool cards, windowed history                | done   |
| 3   | `session/prompt` (text), `cancel`, `updateQueue` forwarded                                  | the native composer sends, steers, queues and stops a remote turn; the plain-textarea view is deleted             | done   |
| 4   | Per-session model catalog + reasoning effort                                                | the composer's model chip is the host's catalog, not this machine's                                               | todo   |
| 5   | Image and file uploads, file references (`@`) resolved on the host                          | pasted images and `@` paths reach the remote agent; cross-machine absolute paths are refused with a stated reason | todo   |
| 6   | jj/workspace path proxies; approvals/questions (waterfall) or the embedded fallback         | a remote thread feels local end to end, or the residual gaps are named in the plugin README                       | todo   |

## Risks and stop conditions

- **Version skew**: frames from an older remote DSH must still decode, or step 2 stops
  at "read the remote transcript through the existing poller".
- **Client services without a runtime dimension** (uploads, file references, model
  catalog) may need their own narrow forks; if that multiplies into "fork the whole
  client", stop and fall back to A.
- Never mutate a remote thread's log from here: mirrored frames are read-only copies,
  and every write goes through the owning runtime's own command surface.

## Resume here

Milestones 1–3 shipped on 2026-10-22: a remote Session is listed, followed, paged,
prompted, cancelled and queue-edited through this Host. The bespoke remote view is
gone; its inventory panel stays as a list of every host's threads.

Evidence (two scratch DSHs, one registered as a local-locator runtime of the other):
`session/list` on A showed B's titled Session, `page` returned its records, `prompt`
was accepted by B, `cancel` reached B, and typing in A's browser composer appeared in
B's log with no console errors
([screenshot](../../plugins/@dshfiles/multi-host/docs/screenshots/remote-thread-native.png)).

Next: milestone 4. The composer's model chip still shows this machine's catalog and
`selectModel` is not mirrored; then uploads and `@` references (5), then workspace and
jj path proxies plus approvals (6).
