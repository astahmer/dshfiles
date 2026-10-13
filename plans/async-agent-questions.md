# Async Agent questions: remaining acceptance

The child question flow, deferred files and revisioned Markdown feedback
shipped in [`@dshfiles/agent-questions`](../plugins/@dshfiles/agent-questions/README.md),
which also records the design decisions. Root timed questions are DSH's own
`tool-ask-user` in `mode: timed` (300 s), already set in
`profiles/web/cordis.patch.yml`. What is left is acceptance, not design.

## Remaining

- [ ] **Root timed mode in a browser.** In a scratch profile with the web seed's
      `tool-ask-user` row, prove: the card with its countdown, the pending result
      after the foreground wait while the Agent continues, a late answer arriving
      as `user-question-reply`, cancellation, and the question surviving a Host
      restart. No e2e journey covers `ask_user_question` today; write one with
      the fake Command Code provider (`tooling/dshx/e2e/support/fake-command-code.ts`).
- [ ] **Child flow on a real provider.** Cold-resume across a Host restart is
      proven only with the synthetic LLM adapter (`pnpm verify:scratch`).
- [ ] **Element anchors** for feedback, once a browser/evidence provider is
      accepted (see I02/I03 in [reference-feature-additions](reference-feature-additions.md)).
- [ ] Split the single `plugin-journeys.feature` scenario that carries six
      agent-questions `@scenario` tags into one scenario per feature.

## Open questions

1. Should `defer` also be offered to a root Agent, or stay subagent-only?
2. Should a child question be answerable by any live ancestor, or only the
   direct parent (current behavior)?
