# Async Agent questions: remaining acceptance

The child question flow, deferred files, revisioned Markdown feedback, the
cross-thread inbox and the root timed mode's browser acceptance shipped in
[`@dshfiles/agent-questions`](../plugins/@dshfiles/agent-questions/README.md),
which documents them with their design decisions. Root timed questions are
DSH's own `tool-ask-user` in `mode: timed` (300 s), set in
`profiles/web/cordis.patch.yml`. The residual native gaps (legacy-schema calls,
inspection-only child forms, estimated deadlines, unprojected queued replies,
the open-form answerer waterfall, stopped roots that cannot receive an answer)
are row 16 of [DSH Host gaps](dsh-host-gaps.md).

## Remaining

- [ ] **Real-provider cold resume.** The live real-provider question and answer
      exchange is documented in the [README](../plugins/@dshfiles/agent-questions/README.md#verify)
      with both the Codex and the DeepSeek Flash routes. Cold resume is proven
      only with the synthetic adapter. With a user-approved live Host restart,
      have a real child ask its parent, restart while the question is pending,
      reattach by question id, answer it, and verify the child continues with the
      answer. Do not share a live login with a scratch Host.
- [ ] **Element anchors** for feedback: element-linked annotations now ship in
      [`@dshfiles/annotations`](../plugins/@dshfiles/annotations/README.md);
      Markdown feedback cannot anchor to one of them yet.

## Open questions

1. Should `defer` also be offered to a root Agent, or stay subagent-only?
2. Should a child question be answerable by any live ancestor, or only the
   direct parent (current behavior)?
