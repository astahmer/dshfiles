Feature: OptMem settings panel

  Summary controls are available in the Settings navigation and apply live.

  @scenario:optmem.settings-panel
  Scenario: Pause and resume summaries from Settings
    Given the isolated plugin profile "@dshfiles/optmem" is booted
    When the OptMem Memory settings section is opened
    Then summarization can be paused and resumed from the settings panel

  @scenario:optmem.workbench-explorer
  Scenario: Browse the dedicated OptMem Explorer and its read-only views
    Given the isolated plugin profile "@dshfiles/optmem" is booted
    When the OptMem Workbench Explorer is opened
    Then Explore, Context Preview and Pipeline remain separate read-only tabs
