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
  Scenario: Find the Editor file-link preference through Settings Search and switch it in General
    DSH 0.2.0-rc.2 gives Settings plugins no owner route (the header and section
    owner props carry no target), so a search result for a field that has a native
    row opens the live editor; the native row is reached through its section.

    Given the isolated plugin composition "@dshfiles/settings-search" and "@dshfiles/editor" is booted
    When the Settings navigation search opens and receives focus
    When the Editor openFileLinks setting is opened from navigation results
    Then the Editor file-link preference opens in the live editor, switched on
    When the Editor file-link preference is switched off in the General section
    Then Settings Search shows the Editor file-link preference switched off
