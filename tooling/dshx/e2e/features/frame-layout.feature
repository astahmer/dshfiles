Feature: Persisted frame panel widths

  The layout bundle replaces the native layout package without patching DSH
  core. Dragged panel widths and the collapsed sidebar live in the browser, so a
  reload reopens the frame where the user left it instead of resetting the
  sidebar to the 280px default.

  @scenario:frame-layout.panel-width-persistence
  Scenario: Keep a dragged sidebar width across a reload
    Given the isolated plugin profile "@dshfiles/frame-layout" is booted
    When the left sidebar handle is dragged 96px wider
    Then the left sidebar column is 376px wide
    And the browser stores a 376px sidebar width
    When the DSH page is reloaded
    Then the left sidebar column keeps the 376px width

  @scenario:frame-layout.collapsed-state-persistence
  Scenario: Keep a collapsed sidebar across a reload
    Given the isolated plugin profile "@dshfiles/frame-layout" is booted
    When the left sidebar handle is dragged 96px wider
    And the sidebar collapse control is used
    Then the sidebar is collapsed
    And the browser stores a collapsed sidebar with a 376px width
    When the DSH page is reloaded
    Then the sidebar is still collapsed
    When the sidebar expand control is used
    Then the left sidebar column is 376px wide again
