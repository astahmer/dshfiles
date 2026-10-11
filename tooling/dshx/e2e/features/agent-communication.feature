Feature: Agent communication browser

  The browser runs against a real isolated Host with an idle Session, stores peer text durably, and does not create Agent execution.

  @scenario:agent-communication.host-report
  Scenario: The Host report remains explicit with a live idle Agent
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then diagnostics show the connected Host and truthful activity history

  @scenario:agent-communication.message-browser
  Scenario: A human can browse a stored channel message without starting an Agent
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then a human post is browsable and remains passive

  @scenario:agent-communication.passive-messaging
  Scenario: A direct message to an offline Agent remains durable and unread
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then an offline direct message remains unread until its recipient reads it

  @scenario:agent-communication.workspace-health
  Scenario: Workspace diagnostics show actual subscriptions without claiming completion
    Given the isolated plugin profile "@dshfiles/agent-communication" is booted
    When the Agent communication panel is opened
    Then workspace diagnostics show the active Agent's workspace subscription
