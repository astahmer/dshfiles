Feature: Settings Search

  The Settings Search plugin indexes live Host settings and edits them through
  the real typed configuration form.

  @scenario:settings-search.settings-index-search
  Scenario: Search the Settings index for a real setting
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings Search section is opened
    When Settings are searched for "maxResults"
    Then the settings index shows the maxResults setting

  @scenario:settings-search.keyboard-navigation
  Scenario: Search and open a native setting with the keyboard
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings navigation search opens and receives focus
    When the maxResults setting is opened with Enter
    Then the selected navigation setting exposes its live typed editor

  @scenario:settings-search.typed-edit
  @scenario:settings-search.reset-override
  @scenario:settings-search.owner-route
  Scenario: Save a numeric setting and restore its inherited value
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings Search section is opened
    When Settings are searched for "maxResults"
    When the maxResults setting is opened
    Then a valid numeric value can be saved and its inherited value restored
