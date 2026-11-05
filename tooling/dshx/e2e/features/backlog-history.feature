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
