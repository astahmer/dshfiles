# Agent Questions

This bundle provides the Host-owned parent/child question contract and its
`ask_parent_question` and `answer_parent_question` tools. It persists each
question under a stable id, binds it to one direct parent and child Session,
and keeps the answer available for a later wait after Host restart.

The contract exposes separate request and wait operations. The child tool
returns the question id when Host shutdown interrupts a wait and accepts that id
to reattach directly. Answers are scoped to the exact parent Session that owns
the request. A cancelled or expired request cannot be answered later.

Each new question names a valid recommended option and an expiry behavior:
`recommended` returns that option to the child when the deadline passes, while
`defer` writes a private Markdown record under the child's workspace
`questions/` directory. Options have an id and label, plus an optional bounded
description. The record includes the question, context, options,
recommendation, child Session id, timestamps, and an answer placeholder. It is
not an answer transport; editing it does not deliver a response to the child.
Deferred file paths are relative, persisted with the question, and reused on
reattachment. Existing version-1 rows remain readable and keep their prior
no-default expiry behavior.

Requests are idempotent per parent, child, and operation id. The Host stores
rows per record under path-safe digests, allows at most 50 pending questions
per parent and 1,000 retained rows, and caps each request at one hour. Terminal
rows are eligible for cleanup after seven days when a later request performs
admission. Host shutdown interrupts active waits without cancelling their
durable pending rows.

The child tool waits three minutes by default. A request may override this with
`timeoutMs` from 1,000 ms to 3,600,000 ms. On expiry, it either returns the
selected recommendation or writes and records the deferred file before the
child continues.

The same Host bundle supports revisioned Markdown feedback. A child submits an
exact workspace-relative line excerpt; the Host records its whole-file SHA-256
revision and rejects unsafe paths, symlinks, or excerpts that no longer match.
The direct parent can resolve up to 20 items in one call. Each resolution has a
durable receipt, and the child can retrieve it later after a one-way wakeup or
Host restart, including after the child Agent stops. The native subagent message
path may cold-resume the persisted direct child to deliver a notice; the durable
receipt remains authoritative if that wake fails. If the document changes or
becomes unreadable before resolution or retrieval, the receipt is marked stale
and the feedback must be re-anchored before the child acts. Feedback is never
applied automatically. Cold-session revision checks read the persisted Session
header through `dsh-session-query`; feedback rows keep only the workspace-relative
path and hash. Element anchors still require a browser/evidence provider.

## Root questions use the native timed mode

This bundle does not touch root questions. The `web` profile switches DSH's own
`tool-ask-user` row to `mode: timed` with a 300 s foreground wait
(`profiles/web/cordis.patch.yml`). After that wait the tool returns
`{ pending: true, callId }` and the root Agent keeps working; the question stays
answerable, and a late answer is steered in as a `user-question-reply` message.
`timeout: -1` still blocks until answered. The browser behavior of that mode
(card, pending result, late answer, cancel, restart) has not been accepted in a
browser yet; see [plans/async-agent-questions.md](../../../plans/async-agent-questions.md).

The Client half only restyles that native card (`src/client.ts`): a tabular,
fixed-width countdown so it stops jittering, a header that stacks below 480 px
of card width, and the question clamped to three lines that expands on hover or
keyboard focus in the header. The card's classes are CSS-module hashes, so the
rules key on `data-question-key`, element structure and class-name suffixes; a
DSH update that reshapes the card drops them silently. A real "Show more"
button needs DOM the card does not expose. The Client has its own
`tsconfig.client.json` because the Client `ISessions` face would win the
`Context.sessions` declaration merge over the Host store the tools use.

## Design decisions

- **Reuse `ask_user_question` for root async, never a second root tool.** Two
  rows with the same tool name throw on insertion, and the Host projection
  (`isTimedAskUserQuestionSchema`) and the Web tool view both hard-code the
  name, so a renamed wrapper would lose the card, countdown and late reply.
- **Subagents get their own tool, routed to the direct parent.** A child cannot
  open the human card (`UserQuestionService.assertLiveRoot` throws
  `DELEGATED_CALLER`), and the card belongs to the root composer. The parent
  answers itself or escalates by asking the human with the ordinary
  `ask_user_question`.
- **The durable row is the answer transport; the inbox is only a wakeup.**
  `ctx.subagents.sendMessage` is one-way and returns a `MessageId`, not a reply
  handle. A prose message to the parent never settles a question.
- **Not built on `@dshfiles/agent-communication`.** That plugin serves
  independent peers through durable topics; a parent/child question is a direct
  runtime relationship with its own ownership checks.
- **Every child question declares a recommendation.** Without one, expiry
  could only block (defeating async) or defer every timeout to a file.
- **Deferred questions are flat, workspace-relative files.** `ls questions/` is
  the index, the files are reviewable and committable, and a later Session can
  pick up open decisions by reading the folder. Nothing prunes the folder; the
  repository owns it.

## Verify

Run `pnpm typecheck`, `pnpm test`, and `pnpm build` from this package. `pnpm verify:scratch` composes the package with its cold-resume fixture in an isolated scratch DSH profile; it does not change the active profile.
