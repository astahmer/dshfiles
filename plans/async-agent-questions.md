# Async Agent questions: remaining acceptance

The child question flow, deferred files and revisioned Markdown feedback
shipped in [`@dshfiles/agent-questions`](../plugins/@dshfiles/agent-questions/README.md),
which also records the design decisions. Root timed questions are DSH's own
`tool-ask-user` in `mode: timed` (300 s), already set in
`profiles/web/cordis.patch.yml`. Browser acceptance remains open; the cross-thread inbox has a plugin-side first milestone, with residual Host gaps tracked in [DSH Host gaps](dsh-host-gaps.md).

## Remaining

- [x] **Root timed mode in a browser** (2026-11-05):
      [agent-questions-timed.feature](../tooling/dshx/e2e/features/agent-questions-timed.feature)
      boots agent-questions with the web seed's own `preset-standard` row (timed
      `tool-ask-user`) and drives the fake Command Code provider. It proves the
      card with a ticking, tabular countdown and the Recommended badge; the
      pending tool result after the foreground wait while the Agent continues; a
      late Submit arriving as a user message tagged `answer_to_pending_question`
      with the call id; Stop withdrawing the form (the open card hides the
      composer, so Stop is reached by closing the card's panel); and the pending
      card shown again after a Host restart. Not proven: that an answer submitted
      after the restart reaches the Agent, since the root Session is stopped then
      (the stopped-root Host gap below).
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
      proven only with the synthetic LLM adapter (`pnpm verify:scratch`). Needs a
      paid provider; skipped in the 2026-11-05 lane.
- [ ] **Element anchors** for feedback, once a browser/evidence provider is
      accepted (see I02/I03 in [reference-feature-additions](reference-feature-additions.md)).
- [x] Split the single `plugin-journeys.feature` scenario into one scenario per
      feature (2026-11-05). The scratch acceptance prints one `PASS[<feature>]`
      line per feature and runs once per worker. It had been failing on main since
      the Effect-native refactor dropped the Promise-shaped `parentQuestions` /
      `parentFeedback` Cordis services its cold-resume fixture injected; the
      fixture now drives the public tools instead.

## Open questions

1. Should `defer` also be offered to a root Agent, or stay subagent-only?
2. Should a child question be answerable by any live ancestor, or only the
   direct parent (current behavior)?
