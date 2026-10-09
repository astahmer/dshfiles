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
