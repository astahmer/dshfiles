Feature: Command palette

  The palette searches live Host data, routes prefixed queries, and invokes
  registered actions. Each scenario boots a disposable profile without API credentials.

  @scenario:command-palette.thread-search
  Scenario: Thread search has a deterministic empty-state without sessions
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is "e2e-no-session-match"
    Then thread search reports no matches

  @scenario:command-palette.file-search
  Scenario: File search explains that the Editor integration is unavailable
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the Go to file action is selected
    Then file search explains that the Editor plugin is unavailable

  @scenario:command-palette.action-registration
  Scenario: A registered theme action is available and can run
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is ">"
    Then the registered dark-theme action is available and can run

  @scenario:command-palette.recent-use-ranking
  Scenario: A recently used action ranks ahead of unused actions
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is ">"
    When the dark-theme action is selected
    When the command palette is reopened
    When the palette query is ">"
    Then the recently used dark-theme action ranks first

  @scenario:command-palette.prefix-routing
  Scenario: Palette prefixes route to their matching views
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    Then command, content, line, and help prefixes open their matching views
