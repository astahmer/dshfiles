Feature: Backlog work queue

  Priorities, sub-issues, the ready queue and agent claims turn the backlog
  into a queue agents pull from without stepping on each other. Every scenario
  uses a fresh isolated profile.

  @scenario:backlog.item-priority
  Scenario: A capture sets its priority with !1, the inspector changes it, and search finds it
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "!1 Fix the outage" is captured as a work item
    And "Plan the offsite" is captured as a work item
    And backlog item b:2 is opened
    And the "Priority" of b:2 is set to "Low" in the inspector
    Then the inspector shows b:2 with priority "Low"
    When the backlog is searched for "priority:urgent"
    Then the search results list only "Fix the outage"

  @scenario:backlog.ready-queue
  Scenario: The Ready view serves unblocked work, urgent first, and a set priority reorders it
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "!4 Tidy the changelog" is captured as a work item
    And "Write the release notes" is captured as a work item
    And "Cut the release" is captured as a work item
    And b:3 depends on b:2
    And the priority of b:2 is set to "High" with its key in the Items view
    And the Ready view is opened
    Then the Ready view lists "Write the release notes, Tidy the changelog" in that order
    When backlog item b:2 is moved to "Done" from its feed context menu
    And the Ready view is opened
    Then the Ready view lists "Tidy the changelog, Cut the release" in that order

  @scenario:backlog.sub-issue-rollup
  Scenario: Sub-issues added from the inspector roll their progress up to the parent
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Ship the work queue" is captured as a work item
    And backlog item b:1 is opened
    And the sub-issue "Add priorities" is added in the inspector
    And the sub-issue "Add claims" is added in the inspector
    Then the inspector shows sub-issue progress "0/2 done"
    When the sub-issue "Add priorities" is opened and marked "Done"
    And its parent is opened from the inspector
    Then the inspector shows sub-issue progress "1/2 done"

  @scenario:backlog.claim-conflict
  Scenario: A second agent cannot take a claimed item, and the user releases the claim
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Shared refactor" is captured as a work item
    When an agent thread claims b:1
    And another agent thread tries to claim b:1
    And the Backlog panel is opened
    And backlog item b:1 is opened
    Then the inspector shows b:1 claimed by the first agent thread only
    When the claim is released in the inspector
    Then the inspector shows b:1 unclaimed in "Todo"
