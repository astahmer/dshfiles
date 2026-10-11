Feature: Thread view presets

  These journeys use a fresh isolated Host profile with no provider credentials.
  View presets and control visibility are changed only through the real sidebar UI.

  @scenario:thread-sidebar.custom-views
  Scenario: Customize named thread views and hide their quick controls
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When saved thread views are created, edited, reordered, disabled, and removed
    Then the custom tabs and hidden controls survive reload
