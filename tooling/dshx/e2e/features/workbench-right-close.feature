Feature: Right pane closes with its last tab

  @scenario:workbench.last-right-tab-close
  Scenario: Closing the final right tab hides the pane while another tab and explicit reopens remain valid
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified right pane is revealed from the main Pane options
    And a Scratchpad view in the right pane receives a draft
    Then closing one of two right tabs keeps the other view and closing the last hides the pane
    And manual right-pane reopen offers one stable chooser that can close the pane again
    And a reload keeps the empty right pane closed and a real view can reopen it
