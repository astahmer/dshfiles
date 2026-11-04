Feature: Agent Questions

  Agent Questions exposes Host-only tools, so its journey boots the real isolated
  plugin profile and then exercises the public tools on a fresh scratch Host.
  No live profile, external provider, or user workspace is used. The scratch Host
  acceptance runs once per worker; each scenario asserts only its own feature's
  evidence line, so a failure names the feature that broke.

  @scenario:agent-questions.parent-answer
  Scenario: A parent answers its direct child's durable question
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.parent-answer"

  @scenario:agent-questions.restart-reattach
  Scenario: A pending question and feedback survive a Host restart
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.restart-reattach"

  @scenario:agent-questions.expiry-defer
  Scenario: An expired question uses its recommendation or defers to a file
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.expiry-defer"

  @scenario:agent-questions.feedback-resolution
  Scenario: Markdown feedback is submitted, read, cancelled and resolved
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.feedback-resolution"

  @scenario:agent-questions.stale-anchor
  Scenario: Feedback on a changed document revision is reported stale
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.stale-anchor"

  @scenario:agent-questions.batch-boundary
  Scenario: An oversized feedback resolution batch is rejected
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.batch-boundary"

  @scenario:agent-questions.cross-thread-inbox
  Scenario: The question inbox lists and guards questions across threads
    Given the isolated plugin profile "@dshfiles/agent-questions" is booted
    When the Agent Questions scratch Host tool journey is run
    Then the scratch Host proves "agent-questions.cross-thread-inbox"
