# Agent Questions

This bundle provides the Host-owned parent/child question contract and its
`ask_parent_question` and `answer_parent_question` tools. It persists each
question under a stable id, binds it to one direct parent and child Session,
and keeps the answer available for a later wait after Host restart.

The contract exposes separate request and wait operations. The child tool
returns the question id when Host shutdown interrupts a wait and accepts that id
to reattach directly. Answers are scoped to the exact parent Session that owns
the request. A cancelled or expired request cannot be answered later.

Requests are idempotent per parent, child, and operation id. The Host stores
rows per record under path-safe digests, allows at most 50 pending questions
per parent and 1,000 retained rows, and caps each request at one hour. Terminal
rows are eligible for cleanup after seven days when a later request performs
admission. Host shutdown interrupts active waits without cancelling their
durable pending rows.

The child tool waits up to three minutes. Expiry returns an explicit no-answer
result; this Host contract does not select a recommended option or write a
deferred-question file. Those outcomes need their own durable Host contract.
