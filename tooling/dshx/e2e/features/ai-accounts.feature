Feature: AI Accounts

  AI Accounts policy settings are available in the real Settings UI.

  @scenario:ai-accounts.failure-recovery
  Scenario: Configure rate-limit failover from AI Accounts settings
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the rate-limit recovery failover can be changed and restored

  @scenario:ai-accounts.usage-window-layout
  Scenario: Configure how account quota windows are displayed
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the usage windows per account can be configured and restored

  @scenario:ai-accounts.credential-recovery
  Scenario: Open credential setup from a missing-key turn
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a provider request fails because its credential is missing
    Then the inline credential action opens AI Accounts
