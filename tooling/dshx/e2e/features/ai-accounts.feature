Feature: AI Accounts

  AI Accounts policy settings are available in the real Settings UI.

  @scenario:ai-accounts.failure-recovery
  Scenario: Inspect the recovery policy for rate-limited requests
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the rate-limit recovery policy exposes its default failover
