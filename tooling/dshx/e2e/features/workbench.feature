Feature: Workbench layouts

  The Workbench docks registered panels in the main area and in the side
  panel, each with its own saved layout.

  @smoke
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

  @scenario:workbench.global-dock
  @scenario:frame-layout.global-dock
  Scenario: The global dock keeps one panel set outside any thread
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the right column is set to the global dock in the plugin settings
    Then the global dock shows the Jujutsu panel
    When a thread is started and the New Session screen opens again
    Then the global dock still shows the Jujutsu panel outside a thread
    When the global dock page is reloaded outside any thread
    Then the global dock still shows the Jujutsu panel after a reload
    When the Jujutsu panel is moved to the main view from the dock
    Then the main view shows the Jujutsu page and the dock no longer shows it
    When the right column is set back to the per-thread panel in the plugin settings

  @scenario:workbench.bottom-panel
  @scenario:frame-layout.bottom-panel
  Scenario: A panel moves from the right column into the bottom panel
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the right column is set to the global dock in the plugin settings
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from the dock header
    Then the bottom panel is open below the columns
    When the Jujutsu panel is moved to the bottom panel
    Then the bottom panel shows the Jujutsu panel and the dock no longer does
    When the bottom panel is hidden again from the dock header

  @scenario:workbench.drag-between-regions
  Scenario: A panel dragged by its tab lands in another region
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the right column is set to the global dock in the plugin settings
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from the dock header
    Then the bottom panel is open below the columns
    And the bottom row shows no panel of its own
    When the Jujutsu tab is dragged from the dock into the bottom panel
    Then the bottom row took the dragged Jujutsu panel and the dock lost it
    When the Jujutsu tab is dragged from the bottom panel back into the dock
    Then the dock took the dragged Jujutsu panel back and the bottom row lost it
    When the bottom panel is hidden again from the dock header

  @scenario:workbench.saved-layouts
  Scenario: A named layout brings a panel back to where it was saved
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the right column is set to the global dock in the plugin settings
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from the dock header
    Then the bottom panel is open below the columns
    And the Jujutsu panel is moved to the bottom panel
    And the current layout is saved as "bottom jujutsu"
    And the Jujutsu panel is moved back to the right column
    Then the dock shows the Jujutsu panel and the bottom panel does not
    When the "bottom jujutsu" layout is applied
    Then the bottom panel shows the Jujutsu panel and the dock no longer does
    When the bottom panel is hidden again from the dock header
    And the right column is set back to the per-thread panel in the plugin settings

  @scenario:workbench.early-open
  Scenario: A panel asked for before the Workbench mounted opens once it does
    Given the isolated plugin composition of "@dshfiles/workbench, @dshfiles/editor, @dshfiles/workspace-folder-picker, @dshfiles/command-palette" is booted
    When a disposable workspace with source, dependency and version-control files has a thread
    And "hello.ts" is opened with Go to file
    Then "hello.ts" opens in the "workbench" editor with its disk content
