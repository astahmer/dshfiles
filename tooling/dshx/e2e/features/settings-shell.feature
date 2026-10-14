Feature: Settings shell

  The ported Settings shell keeps the native sections, opens as a main-view tab
  beside main-tabs and as the native dialog without it, renders every plugin's
  settings with real controls, searches them inline, marks modified settings,
  and offers other ways to open the configuration file. These journeys use a
  fresh isolated Host profile with no provider credentials and the native
  sidebar.

  @scenario:settings-shell.native-port
  Scenario: The ported shell keeps the native sections, General rows and shortcut
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    Then the native sections and General rows show in the Settings dialog
    And the Settings shortcut closes and reopens the dialog

  @scenario:settings-shell.tab
  Scenario: Settings opens as a tab when main-tabs is loaded
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When Settings is opened from the sidebar
    Then Settings fills the main view under its own tab

  @scenario:settings-shell.dialog-expand
  Scenario: The dialog expands to the full window and moves into a tab
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    And the Settings dialog is expanded
    Then the dialog fills the window and can be restored
    When the Settings dialog is moved into a tab
    Then Settings fills the main view

  @scenario:settings-shell.search
  Scenario: Search lists matching settings grouped by page, highlighted and counted
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When Settings is opened from the sidebar
    And Settings are searched for "tabs"
    Then the Main tabs settings are listed with highlights, a count and a tree count
    When Escape is pressed in the search field
    Then the query is cleared and the General section shows again

  @scenario:settings-shell.plugin-controls
  Scenario: Plugin settings render with real controls in Settings and on the Plugins page
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    Then its settings show a titled switch, a bounded number input and segmented choices
    When the Main tabs plugin page is opened from the Plugins panel
    Then the same controls render on the plugin page

  @scenario:settings-shell.modified-reset
  Scenario: A changed setting shows the modified bar and resets to its default
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    And Max tabs is set to 8
    Then the Max tabs row is marked modified and offers Reset to default
    When Max tabs is reset to its default
    Then Max tabs is back to 12 and no longer marked modified

  @scenario:settings-shell.open-config-menu
  Scenario: The configuration file split button offers other ways to open it
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    And the configuration file menu is opened
    Then it offers to copy the configuration file path

  @scenario:editor.open-file-links-native-row
  Scenario: Find the Editor file-link preference through Settings search and switch it in General
    The native General row and the plugin page edit the same Host setting, so
    a switch in either shows in the other.

    Given the isolated plugin composition "@dshfiles/settings-shell" and "@dshfiles/editor" is booted
    When Settings is opened from the sidebar
    And Settings are searched for "open file links"
    Then the Editor file-link preference is found switched on
    When the Editor file-link preference is switched off in the General section
    Then Settings search shows the Editor file-link preference switched off
