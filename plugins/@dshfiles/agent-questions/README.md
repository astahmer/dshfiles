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
`questions/` directory. The record includes the question, context, options,
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

The child tool waits up to three minutes. On expiry, it either returns the
selected recommendation or writes and records the deferred file before the
child continues.
