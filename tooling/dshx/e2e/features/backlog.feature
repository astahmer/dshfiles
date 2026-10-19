Feature: Backlog

  The Backlog panel is one capture box over a feed ordered by activity and a
  board by status, with a peek beside them. These journeys use a fresh
  isolated profile and never call a model provider.

  @scenario:backlog.capture-triage
  Scenario: Capture free text and find it again
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "bug: composer drops chips on paste #composer" is captured
    And "idea: weekly digest of dormant items" is captured
    Then the feed shows "composer drops chips on paste" as a bug in the inbox
    When the backlog is searched for "chips"
    Then the feed lists only "composer drops chips on paste"

  @scenario:backlog.board-links
  Scenario: Move an item on the board and follow its backlinks
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Parent epic" is captured
    And "Child step, part of b:1" is captured
    When item b:2 is moved to In progress on the board
    Then the In progress column holds "Child step, part of b:1"
    When backlog item b:1 is opened
    Then it is referenced by "Child step, part of b:1"
    When the backlink to b:2 is followed
    Then its activity records the move "inbox → doing" by the user
