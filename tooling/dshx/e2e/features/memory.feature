Feature: Thread memory panel

  The Memory panel shows what @dshfiles/memory keeps: notes by type with their
  history, thread digests, and whether agents use and cite memory.

  @scenario:memory.panel-notes
  Scenario: Edit a note with a reason, read its history, then forget it
    Given the isolated plugin profile "@dshfiles/memory" is booted
    And memory holds the project note "Deploys need the ops approval label."
    When the Memory panel is opened
    Then the note "Deploys need the ops approval label." is listed under Project
    And editing it to "Deploys need the ops-approval label and a green canary." keeps the old text in its history
    And forgetting it with a reason removes it from the list

  @scenario:memory.panel-usage
  Scenario: See memory usage per day
    Given the isolated plugin profile "@dshfiles/memory" is booted
    When the Memory panel is opened
    Then the Usage tab shows the memory counters and the usage per day
