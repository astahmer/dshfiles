Feature: Tool call timing

  The fake Command Code model calls the real bash tool for a few seconds, so
  each tool card carries the call and result times DSH recorded.

  @scenario:tool-meta.live-and-final
  Scenario: A running tool call counts up, then shows how long it took and when it started
    Given the isolated plugin composition of "@dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model starts a three-second bash call in a fresh workspace
    Then the running tool card counts its elapsed seconds
    And once the turn settles the tool card shows how long the call took and when it started

  @scenario:tool-meta.wait-timer
  Scenario: A timed wait shows its deadline without presenting it as job progress
    Given the isolated plugin composition of "@dshfiles/tool-meta, @dshfiles/background-jobs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a long shell job starts in the workspace
    And a second thread waits for jobs with a timeout
    Then the wait tool card names its target and shows an accessible timeout progress bar

  @scenario:tool-meta.settings
  Scenario: The start time reads relative, or the line hides, from the plugin settings
    Given the isolated plugin composition of "@dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model starts a three-second bash call in a fresh workspace
    And the tool timing time format is set to "Relative: 12 s ago, 5 min ago."
    Then the tool card start time reads relative to now
    When the tool timing is turned off
    Then no tool card shows a timing

  @scenario:tool-meta.read-code-card @scenario:tool-meta.file-diff-card
  Scenario: A settled read shows its window as code and a settled write shows its diff
    Given the isolated plugin composition of "@dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model reads a window of one file and writes another in a fresh workspace
    Then the read card names the file and numbers the window from the requested offset
    And the write card shows the added lines as a collapsible diff

  @scenario:tool-meta.approval-card
  Scenario: A command asking for more access waits on a risk card until it is rejected
    Given the isolated plugin composition of "@dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks to run a deleting command with more access in a fresh workspace
    Then the approval card rates the command destructive and shows the tool, its reason and the command
    When the approval card is rejected with Escape
    Then the approval card is gone and the command never ran
