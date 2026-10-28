Feature: Content-only single-tab groups

  @scenario:workbench.single-tab-row
  Scenario: Hiding one tab row preserves the view and a real dropped tab reveals it
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When a drafted Scratchpad is the only tab in the centre grid
    And its single tab row is hidden from the tab context menu
    Then the tab row is hidden but its original draft stays mounted
    When its tab row is shown from the content recovery control
    And its single tab row is hidden from the blank row context menu
    And a real Threads tab is dropped onto its content-only group
    Then both tabs are shown and hiding a multiple-tab row is disabled
    When the extra Threads tab is closed
    Then the remaining tab row stays shown with its original draft
    And the global tab-row recovery command and a new tab arriving on reload reveal the row

  @scenario:workbench.sidebar-preview-tab @scenario:thread-sidebar.preview-as-regular-tab
  Scenario: Account Preview is a normal left tab and never resurrects after moving or closing
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    Then the account preview is one ordinary left tab rather than a fixed footer
    When the account preview tab row is hidden and shown again
    And the account preview is moved into the right pane
    Then the account preview placement survives reload without a fixed or left duplicate
    When the ordinary account preview tab is closed and the page is reloaded
    Then the closed account preview stays closed and can reopen from the chooser

  @scenario:workbench.sidebar-preview-legacy-migration
  Scenario: An existing sidebar gains the regular Preview without resetting its other groups
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When an old saved sidebar without a docked Preview is restored
    Then its existing views and hidden row survive the once-only Preview conversion
    And resetting the layout restores the default visible rows and regular Preview
