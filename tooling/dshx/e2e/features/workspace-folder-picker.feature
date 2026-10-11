Feature: Workspace folder picker

  Adding a workspace starts in the Host-backed folder explorer, not the project chooser.

  @scenario:workspace-folder-picker.folder-mode
  Scenario: Open the Add workspace flow in folder mode
    Given the isolated plugin profile "@dshfiles/workspace-folder-picker" is booted
    When the workspace Add workspace action is opened
    Then the picker starts in folder browsing mode without project actions
