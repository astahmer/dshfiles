Feature: Workspace folder picker

  Adding a workspace starts in the Host-backed folder explorer, not the project chooser. A unique typed folder match opens reactively, while ambiguous matches remain selectable.

  @scenario:workspace-folder-picker.header-folder-mode
  Scenario: Open the header Add workspace flow in folder mode
    Given the isolated plugin profile "@dshfiles/workspace-folder-picker" is booted
    When the header workspace Add workspace action is opened
    Then the picker starts in folder browsing mode without project actions
    And a unique typed folder path opens without pressing Enter
    And a typed absolute folder path can be registered without browsing
    And a new folder can be created and registered as a workspace

  @scenario:workspace-folder-picker.sidebar-folder-mode
  Scenario: Open the sidebar Add workspace flow in folder mode
    Given the isolated plugin profile "@dshfiles/workspace-folder-picker" is booted
    When the sidebar Add workspace action is opened
    Then the picker starts in folder browsing mode without project actions
