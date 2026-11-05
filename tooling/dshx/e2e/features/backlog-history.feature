Feature: Backlog item references and history

  New items are named by a short alias instead of a number, and a recorded
  field change can be put back from the item's history. Every scenario uses a
  fresh isolated profile.

  @scenario:backlog.short-item-references
  Scenario: A new item shows a short alias that finds it again
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Short alias demo" is captured
    Then the captured item "Short alias demo" is named by a short alias
    And searching for that alias finds only "Short alias demo"

  @scenario:backlog.revert-field-change
  Scenario: Revert a field change from the item history, and refuse a stale one
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Revert demo" is captured
    And backlog item b:1 is opened
    And the "Kind" of b:1 is set to "Bug" in the inspector
    And the "kind" change from "task" is reverted from the item history
    Then the inspector shows b:1 as a "Task" in "Inbox"
    When the "kind" change from "task" is reverted from the item history
    Then the item history says the kind changed again since

  @scenario:backlog.export-backlog
  Scenario: Export the backlog to a new JSON Lines file from the settings tab
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Export demo" is captured
    And the backlog is exported as JSON Lines from the settings tab
    Then the export file holds the item "Export demo"

  @scenario:backlog.item-timeline-lanes
  Scenario: Agent progress folds into a work log beside the conversation, and agent items stay out of project counts
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Two lane demo" is captured
    When an agent thread comments "Agent progress note" on b:1
    And the agent thread captures "Agent side item" in another project
    And the Backlog panel is opened
    And backlog item b:1 is opened
    And a comment "User decision" is added
    Then the conversation shows "User decision" but not "Agent progress note"
    When the work log is opened
    Then the work log shows "Agent progress note"
    When the Projects view is opened
    Then the project cards count 1 project
    When agent items are shown in the Backlog
    Then the project cards count 2 projects once agent items show

  @scenario:backlog.shipped-digest
  Scenario: Shipped lists what reached done per period, with agent items marked
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Shipped demo" is captured
    When the Shipped view is opened
    And the Shipped period is set to "Day"
    Then today's Shipped bucket shows nothing shipped yet
    When backlog item b:1 is moved to "Done" from its feed context menu
    And the Shipped view is opened
    Then today's Shipped bucket lists "Shipped demo" without an agent badge
    When an agent thread captures "Agent shipped fix" as done
    And the Backlog panel is opened
    And the Shipped view is opened
    Then today's Shipped bucket lists "Agent shipped fix" with an agent badge
    When the Shipped period is set to "Week"
    Then this week's Shipped bucket counts 2 shipped

  @scenario:backlog.shipped-summary
  Scenario: Summarizing a shipped period without a triage model says where to pick one
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Summary demo" is captured
    And backlog item b:1 is moved to "Done" from its feed context menu
    And the Shipped view is opened
    And the Shipped period is set to "Day"
    And today's shipped period is summarized
    Then the summary asks for a triage model and opens the Backlog settings
