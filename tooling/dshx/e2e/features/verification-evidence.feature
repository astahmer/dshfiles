Feature: Verification evidence projection

  Project Checks owns authoritative receipts; Activity Timeline is a safe, replayable summary only.

  @scenario:activity-timeline.verification-receipts
  @scenario:project-checks.activity-projection
  Scenario: Manual outcomes stay factual through navigation and a Host restart
    Given the isolated plugin composition of "@dshfiles/activity-timeline, @dshfiles/project-checks, @dshfiles/workspace-folder-picker" is booted
    When a trusted root holds a jj project and a sibling folder sits outside it
    And the profile trusts the Activity Timeline manual evidence actions
    And a thread is started in the "project" folder
    And "Manual pass" is run from the panel
    And "Manual failure" is run from the panel
    And "Manual timeout" is run from the panel
    And the project working copy changes
    Then the Activity Timeline shows safe receipt facts and current Project Checks freshness
    When the associated Session is opened from the Activity detail
    Then the receipt is backfilled once after restarting the scratch Host
