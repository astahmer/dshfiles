Feature: Backlog list selection

  @scenario:backlog.list-selection-feed
  Scenario: Feed batches only its visible selected entries
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Selection alpha" is captured
    And "Selection bravo" is captured
    And "Selection charlie" is captured
    Then the "feed" backlog list supports coherent batch selection

  @scenario:backlog.list-selection-search
  Scenario: Search results batch only visible matches
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Selection alpha" is captured
    And "Selection bravo" is captured
    And "Selection charlie" is captured
    Then the "search" backlog list supports coherent batch selection

  @scenario:backlog.list-selection-inbox
  Scenario: Inbox selection follows its attention filter
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Selection alpha" is captured
    And "Selection bravo" is captured
    And "Selection charlie" is captured
    And backlog item b:1 is marked "Needs you" from its feed context menu
    And backlog item b:2 is marked "Needs you" from its feed context menu
    And backlog item b:3 is marked "Needs you" from its feed context menu
    Then the "inbox" backlog list supports coherent batch selection

  @scenario:backlog.list-selection-projects
  Scenario: Project item groups batch without selecting project cards
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Selection alpha" is captured
    And "Selection bravo" is captured
    And "Selection charlie" is captured
    Then the "projects" backlog list supports coherent batch selection
