Feature: Workspace editor

  The editor browses, opens and saves files of the thread's workspace through
  Host file APIs. The journey registers a disposable workspace through the real
  folder picker and reads every save back from disk.

  @scenario:editor.file-browse-open
  @scenario:editor.file-index-bounds
  @scenario:editor.save-conflict
  @scenario:editor.write-boundaries
  Scenario: Find, edit and save workspace files within the Host's write boundaries
    Given the isolated plugin composition of "@dshfiles/editor, @dshfiles/workspace-folder-picker, @dshfiles/command-palette, @dshfiles/workbench" is booted
    When a disposable workspace with source, dependency and version-control files has a thread
    Then Go to file lists workspace sources but not dependency or version-control files
    When "hello.ts" is opened with Go to file
    Then "hello.ts" opens in the "workbench" editor with its disk content
    When a line is appended to "hello.ts" and saved
    Then the first save asks for approval and writes the edit to disk
    When src/hello.ts changes on disk while it has unsaved edits and is saved again
    Then the editor reports the conflict and overwrites only when asked
    When the version-control file .git/HEAD is edited from the file tree and saved
    Then the save is refused with the Host reason and the file is unchanged

  @scenario:editor.placement
  Scenario: Files opened from other panels follow the editor placement setting
    Given the isolated plugin composition of "@dshfiles/editor, @dshfiles/workspace-folder-picker, @dshfiles/command-palette, @dshfiles/workbench" is booted
    When a disposable workspace with source, dependency and version-control files has a thread
    And the editor placement is set to "Right panel tab" in the plugin settings
    And "hello.ts" is opened with Go to file
    Then "hello.ts" opens in the "right panel" editor with its disk content
    When the editor placement is set to "Workbench (dockable main-area panel)" in the plugin settings
    And "README.md" is opened with Go to file
    Then "README.md" opens in the "workbench" editor with its disk content
