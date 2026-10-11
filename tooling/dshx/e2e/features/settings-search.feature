Feature: Settings Search

  The Settings Search plugin indexes live Host settings, opens an exact native
  owner route when available, and keeps a typed editor fallback for other fields
  and older shells.

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
  Scenario: Save a numeric setting and restore its inherited value
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings Search section is opened
    When Settings are searched for "maxResults"
    When the maxResults setting is opened
    Then a valid numeric value can be saved and its inherited value restored

  @scenario:settings-search.owner-route
  Scenario: Open Appearance through the native route when the shell supports it
    Given the isolated plugin profile "@dshfiles/settings-search" is booted
    When the Settings navigation search opens and receives focus
    When the ui-theme preference is opened from navigation results
    Then the Appearance preference uses its native owner or typed fallback

  @scenario:editor.open-file-links-native-row
  Scenario: Open the Editor file-link preference through Settings Search
    Given the isolated plugin composition "@dshfiles/settings-search" and "@dshfiles/editor" is booted
    When the Settings navigation search opens and receives focus
    When the Editor openFileLinks setting is opened from navigation results
    Then the Editor file-link preference uses its native General switch and is focused
