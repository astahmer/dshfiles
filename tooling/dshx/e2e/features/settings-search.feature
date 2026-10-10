Feature: Settings Search

  The Settings Search plugin indexes live Host settings and edits them through
  the real typed configuration form.

  @scenario:settings-search.settings-index-search
  Scenario: Search the Settings index for a real setting
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings Search section is opened
    When Settings are searched for "maxResults"
    Then the settings index shows the maxResults setting

  @scenario:settings-search.typed-setting-editor
  Scenario: Save a numeric setting and restore its inherited value
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings Search section is opened
    When Settings are searched for "maxResults"
    When the maxResults setting is opened
    Then a valid numeric value can be saved and its inherited value restored
