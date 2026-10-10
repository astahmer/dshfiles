Feature: Agent communication inspector

  The inspector loads diagnostics from a real isolated DSH Host without an external model call.

  @scenario:agent-communication.host-report
  Scenario: The empty Host report is available and explicit
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then diagnostics show the connected Host and truthful empty history
