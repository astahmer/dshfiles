Feature: Shortcuts

  The isolated shortcuts bundle uses the real DSH layout service and browser
  keyboard. Primary follows the platform reported by the browser.

  @scenario:shortcuts.sidebar-toggle
  Scenario: Toggle the sidebar from the composer
    Given the isolated plugin profile "@dshfiles/shortcuts" is booted
    When the composer is focused
    Then the sidebar starts expanded
    When the platform primary+B chord is pressed
    Then the sidebar toggles closed and reopens

  @scenario:shortcuts.platform-primary
  Scenario: Only the current platform primary modifier toggles the sidebar
    Given the isolated plugin profile "@dshfiles/shortcuts" is booted
    When the composer is focused
    When the alternate platform modifier+B chord is pressed
    Then the sidebar remains expanded after the alternate chord
    When the platform primary+B chord is pressed
    Then the sidebar toggles and is restored with the primary modifier

  @scenario:shortcuts.repeated-keydown
  Scenario: Repeating a held primary+B chord toggles the sidebar only once
    Given the isolated plugin profile "@dshfiles/shortcuts" is booted
    When the composer is focused
    When the platform primary+B key is held and repeated before release
    Then the sidebar toggles only once for the repeated keydown

  @scenario:shortcuts.unclaimed-events
  Scenario: An extra Shift modifier leaves primary+B unclaimed
    Given the isolated plugin profile "@dshfiles/shortcuts" is booted
    When primary+Shift+B is pressed
    Then the sidebar remains expanded after the unmatched chord
