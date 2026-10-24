Feature: Thread memory panel

  The Memory panel shows what @dshfiles/memory keeps: notes by type with their
  history, thread digests, and whether agents use and cite memory. Conversation
  citations open their referenced note or digest inline.

  @scenario:memory.panel-notes
  Scenario: Edit a note with a reason, read its history, then forget it
    Given the isolated plugin profile "@dshfiles/memory" is booted
    And memory holds the project note "Deploys need the ops approval label."
    When the Memory panel is opened
    Then the note "Deploys need the ops approval label." is listed in the Notes tab
    And editing it to "Deploys need the ops-approval label and a green canary." keeps the old text in its history
    And forgetting it with a reason removes it from the list

  @scenario:memory.panel-archive
  Scenario: Archive and restore a saved note without deleting it
    Given the isolated plugin profile "@dshfiles/memory" is booted
    And memory holds the project note "The staging token expires after one hour."
    When the Memory panel is opened
    Then the note "The staging token expires after one hour." is listed in the Notes tab
    When the note "The staging token expires after one hour." is archived from Memory
    And the archived note "The staging token expires after one hour." is restored
    Then the restored note "The staging token expires after one hour." is listed in the Notes tab

  @scenario:memory.panel-first-note
  Scenario: Write the first memory on a profile with a registered project
    Given the isolated plugin profile "@dshfiles/memory" is booted
    When the Memory panel is opened
    And the Add memory dialog is given the project path "/work/e2e-project" and the note "Backlog items are never deleted."
    Then the note "Backlog items are never deleted." is listed in the Notes tab

  @scenario:memory.panel-usage
  Scenario: See memory usage per day
    Given the isolated plugin profile "@dshfiles/memory" is booted
    When the Memory panel is opened
    Then the Analytics tab shows the memory counters and the activity charts

  @scenario:memory.panel-batch-forget
  Scenario: Forget several notes in one confirmed action
    Given the isolated plugin profile "@dshfiles/memory" is booted
    And memory holds the project note "Deploys need the ops approval label."
    And memory holds the project note "Nightly runs start after the cache warms."
    When the Memory panel is opened
    And selection mode is on
    And two visible notes are selected
    Then forgetting the selection after confirmation empties the list

  @scenario:memory.reference-preview
  Scenario: Open a cited correction note inline from a conversation
    Given the isolated plugin composition of "@dshfiles/memory, @dshfiles/ai-accounts" is booted
    And memory holds the feedback note "A long correction note title must wrap inside a compact preview instead of stretching across the conversation, while keeping its source and actions easy to reach."
    And a Command Code account backed by a local fake provider is added
    When a thread on the fake model cites memory "n:1"
    Then the inline memory preview shows "A long correction note title must wrap inside a compact preview instead of stretching across the conversation, while keeping its source and actions easy to reach."
    And opening the preview in Memory focuses "A long correction note title must wrap inside a compact preview instead of stretching across the conversation, while keeping its source and actions easy to reach."

  @scenario:memory.reference-digest
  Scenario: Preview a cited digest, then a bounded excerpt of it
    Given the isolated plugin composition of "@dshfiles/memory, @dshfiles/ai-accounts" is booted
    And memory holds a digest of thread "session-e2e-digest" titled "Ship the release notes" saying "Release notes ship with the canary switch."
    And a Command Code account backed by a local fake provider is added
    When a thread on the fake model cites memory "t:session-e2e-digest"
    Then the inline digest preview shows "Release notes ship with the canary switch."
    When a thread on the fake model cites memory "t:session-e2e-digest#1"
    Then the inline excerpt preview shows "not readable"
