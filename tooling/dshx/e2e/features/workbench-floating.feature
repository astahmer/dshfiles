Feature: Window-wide floating panels from root Workbench panes

  @scenario:workbench.window-wide-floating
  Scenario: A real Threads tab floated from the left pane can move beyond that pane and dock elsewhere
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the real left Threads tab is floated from its context menu
    And its floating titlebar is dragged over the centre of the window
    Then the floating Threads body is visible and interactive outside the left pane without remounting
    And the floating Threads placement survives reload and viewport resize
    When the floating Threads tab is dragged into the main pane
    Then the same Threads occurrence is docked in main with no duplicate floating copy

  @scenario:workbench.floating-overlap-order
  Scenario: Overlapping native floating windows keep their own chrome content and draft ordering
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the real left Threads tab is floated from its context menu
    And its floating titlebar is dragged over the centre of the window
    Then the floating Threads body is visible and interactive outside the left pane without remounting
    When a drafted Scratchpad is the only tab in the centre grid
    And the final centre Scratchpad tab is floated with the real Shift gesture
    Then the second floating window keeps its draft and wins overlap hit testing

  @scenario:workbench.floating-source-offset
  Scenario: A right-pane float follows native content coordinates when its source origin moves
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified right pane is revealed from the main Pane options
    And a Scratchpad view in the right pane receives a draft
    And the real right Scratchpad tab is floated from its context menu
    And its floating titlebar is dragged over the centre of the window
    Then the floating draft remains aligned after its source origin moves
