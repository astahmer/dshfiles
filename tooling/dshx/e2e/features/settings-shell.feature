Feature: Settings shell

  The ported Settings shell is one page in the stage (plans/ade-ux §4.6): it
  keeps the native sections, groups every section and plugin page by task,
  links the pages other plugins own, renders every plugin's settings with real
  controls, searches them and key bindings inline, marks modified settings,
  and offers other ways to open the configuration file. These journeys use a
  fresh isolated Host profile with no provider credentials and the native
  sidebar.

  @scenario:settings-shell.native-port
  Scenario: The ported shell keeps the native sections, General rows and shortcut
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    Then the native sections and General rows show on the Settings page
    And the Settings shortcut closes and reopens the page

  @scenario:settings-shell.compact-navigation
  Scenario: Settings keep section navigation and search usable in narrow windows
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    Then Settings remain usable at narrow and wide widths

  @scenario:settings-shell.dsh-release-notice
  Scenario: Settings checks new DSH releases against the installed version
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    Then the DSH release status and manual check action are available

  @smoke
  @scenario:settings-shell.tab
  Scenario: Settings opens as a tab when main-tabs is loaded
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When Settings is opened from the sidebar
    Then Settings fills the main view under its own tab

  @scenario:settings-shell.grouped-page
  Scenario: Settings groups sections and plugin pages by task and finds key bindings
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When Settings is opened from the sidebar
    Then the page lists its task groups with human page titles and no dialog
    When Settings are searched for "open settings"
    Then the Open Settings key binding is listed with its keys

  @scenario:settings-shell.search
  Scenario: Search lists matching settings grouped by page, highlighted and counted
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When Settings is opened from the sidebar
    And Settings are searched for "tabs"
    Then the Main tabs settings are listed with highlights, a count and a tree count
    When Escape is pressed in the search field
    Then the query is cleared and the General section shows again

  @scenario:settings-shell.search-section-entries
  Scenario: Search finds a section control while the section is unmounted and opens the section at it
    Given the isolated plugin profile "@dshfiles/settings-shell" is booted
    When Settings is opened from the sidebar
    And Settings are searched for "coding view"
    Then the coding view switch is listed under General
    When that search entry is picked
    Then the General section shows with the coding view switch focused

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

  @scenario:settings-shell.reset-while-saving
  Scenario: Reset to default right after a change resets once the change is saved
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    And settings writes are held
    And Max tabs is set to 8
    And Max tabs is reset to its default
    And the held settings writes finish
    Then the Host accepted both writes and Max tabs is back to 12

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
