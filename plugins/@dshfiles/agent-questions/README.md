# Agent Questions

This bundle provides the Host-owned parent/child question contract required
before the `ask_parent_question` tool can be added. It persists each question
under a stable id, binds it to one direct parent and child Session, and keeps
the answer available for a later wait after Host restart.

The contract exposes separate request and wait operations. The request id is
returned before waiting, so it is present in the child Session history and can
be supplied again after an interrupted wait. Answers are scoped to the exact
parent Session that owns the request. A cancelled or expired request cannot be
answered later.

Requests are idempotent per parent, child, and operation id. The Host stores
rows per record under path-safe digests, allows at most 50 pending questions
per parent and 1,000 retained rows, and caps each request at one hour. Terminal
rows are eligible for cleanup after seven days when a later request performs
admission. Host shutdown interrupts active waits without cancelling their
durable pending rows.

This Host contract does not add the child request tool, authorized parent answer
action, or deferred-question files yet. Those belong to the next acceptance
phase.
