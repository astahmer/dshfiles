Feature: Command palette

  The palette searches live Host data, routes prefixed queries, and invokes
  registered actions. Each scenario boots a disposable profile without API credentials.

  @scenario:command-palette.thread-search
  Scenario: Thread search has a deterministic empty-state without sessions
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is "e2e-no-session-match"
    Then thread search reports no matches

  @scenario:command-palette.content-search
  Scenario: Content search finds a real user message and opens its thread
    Given the isolated plugin profile "@dshfiles/command-palette" is booted with the session-content index
    When a searchable user message is sent to a new thread
    When the command palette is opened
    When the palette query is "#dshx-content-search-e2e-marker"
    Then thread content search finds the message and opens its thread
    Then the content-search index exists under the isolated DSH home

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

  @scenario:command-palette.thread-tabs-and-escape
  Scenario: Thread tabs, prefixes, and Escape navigation stay inside the palette
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    Then Everything, Threads, and Files tabs are available
    When the Threads tab is selected
    Then the Threads tab is active
    When the palette query is "thread:session-e2e-missing"
    Then the thread prefix opens a backable thread subview
    When Escape is pressed in the command palette
    Then the palette returns to Threads search
    When the Everything tab is selected
    When Escape is pressed in the command palette
    Then Escape clears the palette query without closing it

  @scenario:command-palette.session-link-search
  Scenario: A pasted session link uses its ID and ignores unrelated query parameters
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is "session:https://dsh.example.invalid/?thread=session-e2e-missing&workspace=workspace-e2e&token=fake-value"
    Then the palette reports that session "session-e2e-missing" was not found

  @scenario:command-palette.new-thread-action
  Scenario: New thread is searchable in the command palette
    Given the isolated plugin profile "@dshfiles/command-palette" is booted
    When the command palette is opened
    When the palette query is "New thread"
    Then the New thread action is available and can run

  @scenario:command-palette.new-thread-cmd-k
  Scenario: Cmd+K opens the palette with the New thread action
    Given the web profile is booted
    When Cmd+K opens the command palette
    When the palette query is "New thread"
    Then the New thread action is available and can run
