Feature: AI Accounts

  AI Accounts policy settings are available in the real Settings UI.

  @scenario:ai-accounts.account-draft
  @scenario:ai-accounts.save-policy
  Scenario: Keep and save an account draft in manual mode
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Codex account draft is edited in manual save mode
    Then the manual draft saves and persists when AI Accounts is reopened

  @scenario:ai-accounts.failure-recovery
  Scenario: Configure rate-limit failover from AI Accounts settings
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the rate-limit recovery failover can be changed and restored

  @scenario:ai-accounts.quota-retry-settings
  Scenario: Configure the exhausted-limit retry choice
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the exhausted-limit retry default is off and the inline choice is on

  @scenario:ai-accounts.usage-window-layout
  Scenario: Configure how account quota windows are displayed
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the usage windows per account can be configured and restored

  @scenario:ai-accounts.history-retention
  Scenario: Configure usage history cadence and retention
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the usage history cadence and retention can be changed and restored

  @scenario:ai-accounts.credential-recovery
  Scenario: Open credential setup from a missing-key turn
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a provider request fails because its credential is missing
    Then the inline credential action opens AI Accounts

  @scenario:ai-accounts.priority-order
  Scenario: Reorder accounts used by Priority routing
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When two Codex accounts are added with Priority distribution
    Then the account order controls Priority routing
