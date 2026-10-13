Feature: Project checks

  Trusted actions are written to the scratch profile's patch file the way an
  operator configures them, and each run leaves a receipt in the panel.

  @scenario:project-checks.trusted-root
  Scenario: Trusted actions run only inside their trusted root
    Given the isolated plugin composition "@dshfiles/project-checks" and "@dshfiles/workspace-folder-picker" is booted
    When a trusted root holds a jj project and a sibling folder sits outside it
    And the profile trusts the action "Unit check" that runs "echo checked"
    And a thread is started in the "project" folder
    And "Unit check" is run from the panel
    Then the action ran in the trusted project and left a passed receipt
    When a thread is started in the "sibling" folder
    And the project checks panel is opened
    Then the sibling folder offers no trusted action

  @scenario:project-checks.receipt-freshness
  Scenario: A receipt turns stale once the working copy changes
    Given the isolated plugin composition "@dshfiles/project-checks" and "@dshfiles/workspace-folder-picker" is booted
    When a trusted root holds a jj project and a sibling folder sits outside it
    And the profile trusts the action "Unit check" that runs "echo checked"
    And a thread is started in the "project" folder
    And "Unit check" is run from the panel
    Then the receipt names the working copy it checked
    When the project working copy changes
    Then the receipt is marked stale

  @scenario:project-checks.verify-retry
  Scenario: A failing completion check steers the agent once, then stops the turn
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a trusted root holds a jj project and a sibling folder sits outside it
    And the profile trusts the completion check "Completion check" that runs "exit 3"
    And a Command Code account backed by a local fake provider is added
    And a thread on the fake model is started in the trusted project
    And "finish the task" is sent to the fake model
    Then the failing check asks the agent to fix it once, then stops the turn
