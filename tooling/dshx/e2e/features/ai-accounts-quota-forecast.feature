Feature: AI Accounts quota forecast

  @scenario:ai-accounts.quota-forecast
  Scenario: Read an account's quota forecast and hand-off guidance
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a second healthy Command Code account is added
    Then the quota forecast shows its account and forecast views
