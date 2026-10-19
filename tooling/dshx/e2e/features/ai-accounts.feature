Feature: AI Accounts

  AI Accounts policy settings are available in the real Settings UI.

  @smoke
  @scenario:ai-accounts.account-draft
  @scenario:ai-accounts.save-policy
  Scenario: Keep and save an account draft in manual mode
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Codex account draft is edited in manual save mode
    Then the manual draft saves and persists when AI Accounts is reopened

  @scenario:ai-accounts.account-removal
  Scenario: Cancel and confirm account removal
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Codex account is ready for removal
    Then account removal can be canceled and confirmed

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

  @scenario:ai-accounts.pricing-cost
  Scenario: Override model pricing without refreshing the catalog
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the price refresh interval and explicit override can be changed and restored

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

  @scenario:ai-accounts.model-curation
  Scenario: Hide or show AI Accounts on the Models page
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the AI Accounts settings section is opened
    Then the AI Accounts list on the Models page can be hidden and restored

  @scenario:ai-accounts.quota-display
  Scenario: Read account quota windows from the provider
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    Then the account shows the session and weekly windows the provider reports
    When a second Command Code account whose billing read fails is added
    Then the failed account reports the provider error instead of a quota

  @scenario:ai-accounts.strip-short-names
  Scenario: Rename an account's short name in the usage strip and hide short names
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    Then the usage strip shows its short name, renamed from AI Accounts settings
    And the strip's context menu hides and shows short names

  @scenario:ai-accounts.usage-popover-resize
  Scenario: Resize the usage popover until its accounts sit side by side
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a second healthy Command Code account is added
    Then widening the usage popover from its grip lays the accounts out side by side
    And the usage popover keeps its size until its grip is double-clicked

  @scenario:ai-accounts.pool-failover
  Scenario: A rate-limited account hands the turn to a healthy one
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a rate-limited and a healthy Command Code account share a local fake provider
    And a new thread asks the first account's model a question
    Then the healthy account answers and the rate-limited one cools down

  @scenario:ai-accounts.priority-routing
  Scenario: Priority serves each request from the first healthy account in list order
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a rate-limited and a healthy Command Code account share a local fake provider
    And request distribution is set to Priority
    And a new thread asks the second account's model a question
    Then the first account is tried, the healthy one answers, and the next request goes straight to it

  @scenario:ai-accounts.model-fallback-chain @scenario:model-effort-picker.fallbacks-browser-journey
  Scenario: A thread's fallback chain takes over from a rate-limited account
    Given the isolated AI Accounts and model effort picker plugin profile is booted
    When a rate-limited and a healthy Command Code account share a local fake provider
    And a third Command Code account is added
    And request distribution is set to Priority
    And a new thread falls back from the first account to the third one in the composer picker
    And the thread asks a question
    Then the third account answers instead of the next account in the list
    And the picker offers to return the thread to its selection

  @scenario:ai-accounts.quota-recovery-route
  Scenario: Recover an exhausted turn on another route
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When an exhausted Command Code account fails a turn with failover off
    Then the exhausted turn offers an inline route switch and one-minute auto-resume

  @scenario:ai-accounts.quota-auto-resume
  Scenario: Resume an exhausted turn on its own after the limit resets
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a briefly exhausted Command Code account fails a turn with auto-resume on
    Then the turn resumes on its own one minute after the reset
