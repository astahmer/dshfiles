# Async Agent questions: remaining acceptance

The child question flow, deferred files and revisioned Markdown feedback
shipped in [`@dshfiles/agent-questions`](../plugins/@dshfiles/agent-questions/README.md),
which also records the design decisions. Root timed questions are DSH's own
`tool-ask-user` in `mode: timed` (300 s), already set in
`profiles/web/cordis.patch.yml`. Browser acceptance remains open; the cross-thread inbox has a plugin-side first milestone, with residual Host gaps tracked in [DSH Host gaps](dsh-host-gaps.md).

## Remaining

- [ ] **Root timed mode in a browser.** In a scratch profile with the web seed's
      `tool-ask-user` row, prove: the card with its countdown, the pending result
      after the foreground wait while the Agent continues, a late answer arriving
      as `user-question-reply`, cancellation, and the question surviving a Host
      restart. No e2e journey covers `ask_user_question` today; write one with
      the fake Command Code provider (`tooling/dshx/e2e/support/fake-command-code.ts`).
- [x] **Plugin-side cross-thread inbox (first milestone).** `list_thread_questions`
      lists native timed question projections across all Sessions for a root Agent
      or filters one Session, plus durable pending questions from the caller's
      direct children. It surfaces recommendations, blocking/timed mode,
      answerability, expiry, and an event-derived countdown estimate without
      scanning transcripts. `answer_thread_question` submits a complete batch to
      a continued native form on a live root; `answer_parent_question` answers a
      direct child.
- [ ] **Close residual native Host gaps.** Legacy-schema calls remain outside
      the projection; native forms on child Sessions are inspection-only; timed
      deadlines are estimates rather than exact Host timer snapshots; queued
      replies are not projected before Agent admission; open forms still use the
      active answerer waterfall; and stopped root Sessions cannot be resumed to
      receive an answer. Add an exact non-claiming timer snapshot and a
      race/cancel-safe open-form broker or Host service. See the Host gap above.
- [ ] **Child flow on a real provider.** Cold-resume across a Host restart is
      proven only with the synthetic LLM adapter (`pnpm verify:scratch`).
- [ ] **Element anchors** for feedback, once a browser/evidence provider is
      accepted (see I02/I03 in [reference-feature-additions](reference-feature-additions.md)).
- [ ] Split the single `plugin-journeys.feature` scenario that carries seven
      agent-questions `@scenario` tags into one scenario per feature.

## Open questions

1. Should `defer` also be offered to a root Agent, or stay subagent-only?
2. Should a child question be answerable by any live ancestor, or only the
   direct parent (current behavior)?
