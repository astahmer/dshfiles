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
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/settings-shell, @dshfiles/main-tabs" is booted
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
    Then Max tabs is back to 10 and no longer marked modified

  @scenario:settings-shell.json-editor
  Scenario: The JSON view edits overrides with diagnostics, shows the defaults and the form shows each source
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    And Max tabs is set to 8
    Then the Max tabs row says it is an override that inherits 10
    When the Main tabs page is shown as JSON
    Then the JSON overrides hold Max tabs 8 and the defaults view holds 10
    When the JSON overrides add an unknown key
    Then the JSON editor names the unknown key and cannot save
    When the JSON overrides set Max tabs to 12 and are saved
    Then the form shows Max tabs 12 marked modified
    When Settings are searched for "@modified"
    Then only the Max tabs setting is listed

  @scenario:settings-shell.plugin-entry-card
  Scenario: A plugin page names its Loader entry, the bundle that declares it and its switch
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    Then the page names its plugin entry, its bundle and a plugin switch

  @scenario:settings-shell.json-stays-on-focus
  Scenario: A field opened from search or a link while JSON shows stays in JSON with its key selected
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    And Max tabs is set to 8
    And the Main tabs page is shown as JSON
    And Settings are searched for "max tabs" and the Main tabs result is opened
    Then the Main tabs page still shows JSON
    When a link opens the Max tabs setting
    Then the JSON editor selects the maxTabs key

  @scenario:settings-shell.json-phone-keyboard
  Scenario: At phone width the JSON view is reached, edited and saved with the keyboard alone
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the viewport is 390 pixels wide and Settings opens from its shortcut
    And the Main tabs page is found and opened with the keyboard
    And the JSON view is chosen and an override is saved with the keyboard
    Then the page fits the phone width and the form shows the saved override

  @scenario:settings-shell.reset-while-saving
  Scenario: Reset to default right after a change resets once the change is saved
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/main-tabs" is booted
    When the Main tabs page is opened in Settings
    And settings writes are held
    And Max tabs is set to 8
    And Max tabs is reset to its default
    And the held settings writes finish
    Then the Host accepted both writes and Max tabs is back to 10

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

  @scenario:settings-shell.shared-jev-key
  Scenario: The one Jev key leads Settings › Tools & MCP › Jev
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/backlog, @dshfiles/memory" is booted
    When Settings is opened from the sidebar
    And Settings are searched for "Jev"
    Then the shared Jev key is listed once and the plugins' earlier key fields are not
  @scenario:settings-models.models-settings
  Scenario: The Models settings section comes from the owned fork
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/settings-models" is booted
    When the Models page is opened in Settings
    Then the Models section renders the owned fork instead of a placeholder

  @scenario:settings-web-search.web-search-settings
  Scenario: The Web search plugin page comes from the owned fork
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/settings-web-search" is booted
    When the Web search plugin page is opened in Settings
    Then the Web search page renders the owned fork instead of a placeholder

  @scenario:settings-subagent.subagent-settings
  Scenario: The Subagent plugin page comes from the owned fork
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/settings-subagent" is booted
    When the Subagent plugin page is opened in Settings
    Then the Subagent page renders the owned fork instead of a placeholder
