Feature: Agent Questions

  Agent Questions exposes Host-only tools, so its journey boots the real isolated
  plugin profile and then exercises the public tools on a fresh scratch Host.
  No live profile, external provider, or user workspace is used.

  @scenario:agent-questions.parent-answer
  @scenario:agent-questions.restart-reattach
  @scenario:agent-questions.expiry-defer
  @scenario:agent-questions.feedback-resolution
  @scenario:agent-questions.stale-anchor
  @scenario:agent-questions.batch-boundary
  @scenario:agent-questions.cross-thread-inbox
  Scenario: Parent and child complete durable questions, inbox tools, and guarded feedback
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the public question and feedback tools pass their real Host acceptance cases
