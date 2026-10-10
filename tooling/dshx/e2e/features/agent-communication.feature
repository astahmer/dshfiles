Feature: Agent communication inspector

  The inspector loads diagnostics from a real isolated DSH Host without an external model call.

  @scenario:agent-communication.host-report
  Scenario: The empty Host report is available and explicit
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then diagnostics show the connected Host and truthful empty history

  @scenario:agent-communication.delivery-policy
  Scenario: The subscription controls do not invent delivery policies
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then subscription controls show no configured delivery policy

  @scenario:agent-communication.inbox
  Scenario: The durable inbox reports an empty message history
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then the inbox reports no recent messages
