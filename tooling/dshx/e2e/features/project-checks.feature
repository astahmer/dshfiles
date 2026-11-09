Feature: Project checks

  Trusted actions are written to the scratch profile's patch file the way an
  operator configures them, and each run leaves a receipt in the panel.

  @scenario:project-checks.trusted-root
  Scenario: Trusted actions run only inside their trusted root
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/workspace-folder-picker" is booted with the trusted action "Unit check" that runs "echo checked"
    When a thread is started in the "project" folder
    And "Unit check" is run from the panel
    Then the action ran in the trusted project and left a passed receipt
    When a thread is started in the "sibling" folder
    And the project checks panel is opened
    Then the sibling folder offers no trusted action

  @scenario:project-checks.receipt-freshness
  Scenario: A receipt turns stale once the working copy changes
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/workspace-folder-picker" is booted with the trusted action "Unit check" that runs "echo checked"
    When a thread is started in the "project" folder
    And "Unit check" is run from the panel
    Then the receipt names the working copy it checked
    When the project working copy changes
    Then the receipt is marked stale

  @scenario:project-checks.verify-retry
  @scenario:project-checks.activity-retry-projection
  @scenario:activity-timeline.verification-retry
  Scenario: A failing completion check steers the agent once, then stops the turn
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/activity-timeline" is booted with the trusted completion check "Completion check" that runs "printf PRIVATE_EVIDENCE_SENTINEL >&2; exit 3"
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is started in the trusted project
    And "finish the task" is sent to the fake model
    Then the failing check asks the agent to fix it once, then stops the turn
    And each failed attempt is projected exactly once with safe metadata

  @scenario:jj-integration.workspace-setup-browser-journey
  Scenario: A trusted setup action prepares a new thread workspace
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration" is booted with the trusted setup action "Setup install" that runs "printf started > .setup-ran; sleep 4"
    When the "project" folder is added as the New thread project
    And the New thread workspace is set to its own workspace
    And a message is sent while its workspace setup runs
    Then the setup ran once in the thread workspace, not the project checkout

  @scenario:project-checks.timeline-absent
  Scenario: Project Checks persists the receipt without Activity Timeline installed
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/workspace-folder-picker" is booted with the trusted action "Manual pass" that runs "printf checked"
    When a thread is started in the "project" folder
    And "Manual pass" is run from the panel
    Then the receipt is available without Activity Timeline

  @scenario:project-checks.activity-cancel-projection
  @scenario:activity-timeline.verification-cancelled
  Scenario: Cancelling an automatic check remains a separate non-failure outcome
    Given the isolated plugin composition of "@dshfiles/project-checks, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/activity-timeline" is booted with the trusted completion check "Interruptible check" that runs "printf started > .verification-started; sleep 30"
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is started in the trusted project
    When the fake model is sent a message while the completion check runs and the turn is cancelled
    Then the cancelled check remains available in Project Checks
    And the Activity Timeline labels cancellation as notable, not failure
