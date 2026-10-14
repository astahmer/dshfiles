Feature: Workbench layouts

  The Workbench docks registered panels in the main area and in the side
  panel, each with its own saved layout.

  @scenario:workbench.default-layout
  @scenario:workbench.persisted-layout
  Scenario: The default layout persists, resets and survives a corrupt save
    Given the isolated plugin composition of "@dshfiles/workbench, @dshfiles/editor" is booted
    When the Workbench is opened
    Then the default layout shows the Editor alone
    When the Editor panel is closed and the page is reloaded
    Then the closed panel stays closed and can be added back
    When the saved Workbench layout is corrupted and the page is reloaded
    Then the Workbench falls back to its default layout

  @scenario:workbench.missing-plugin
  Scenario: A panel whose plugin is disabled waits as a placeholder
    Given the isolated plugin composition of "@dshfiles/workbench, @dshfiles/editor" is booted
    When the Workbench is opened
    And the Editor tab is selected and the editor plugin is disabled
    Then the Editor tab stays as a closable placeholder
    When the editor plugin is enabled again
    Then the Editor tab shows the editor again

  @scenario:workbench.surface-layouts
  Scenario: The side panel keeps a layout apart from the main Workbench
    Given the isolated plugin composition of "@dshfiles/workbench, @dshfiles/editor" is booted
    When a thread opens the Workbench side panel and closes its Editor
    Then the main Workbench keeps its own layout

  @scenario:workbench.early-open
  Scenario: A panel asked for before the Workbench mounted opens once it does
    Given the isolated plugin composition of "@dshfiles/workbench, @dshfiles/editor, @dshfiles/workspace-folder-picker, @dshfiles/command-palette" is booted
    When a disposable workspace with source, dependency and version-control files has a thread
    And "hello.ts" is opened with Go to file
    Then "hello.ts" opens in the "workbench" editor with its disk content
