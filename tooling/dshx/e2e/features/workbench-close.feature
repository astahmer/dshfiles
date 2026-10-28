Feature: Workbench conversation close ownership

  @scenario:workbench.repeated-close-navigation
  Scenario: Repeated real tab close gestures never activate the closed chat or replace another conversation
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And each fixed-session conversation receives its own draft
    And a third real Workbench conversation has its own draft
    Then closing inactive and active Workbench tabs preserves the correct existing conversations
    And the workbench main acceptance journey is complete
