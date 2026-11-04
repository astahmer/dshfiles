Feature: Backlog views

  The approved Backlog views walked as a user does: the feed's day
  separators, the Inbox filters, the Items grouping, Projects, search
  operators, saved views, the capture composer and the item inspector.
  Every scenario uses a fresh isolated profile; only the triage suggestion
  scenario talks to a model, and that one is the local fake provider.

  @scenario:backlog.feed-day-separators
  Scenario: The feed separates entries by day
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "First entry of the day" is captured
    And "Second entry of the day" is captured
    Then the feed shows one "Today" separator above both entries

  @scenario:backlog.inbox-filters
  Scenario: Read the Inbox by filter, mark a request read and resolve another
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Pick a cache key" is captured
    And "Deploy is stuck on review" is captured
    And "Nothing to decide here" is captured
    And backlog item b:1 is marked "Needs you" from its feed context menu
    And backlog item b:2 is marked "Blocked" from its feed context menu
    And the Backlog Inbox is opened
    Then the Inbox "All" filter lists b:1 and b:2 but not b:3
    And the Inbox "Needs you" filter lists only b:1
    And the Inbox "Blocked" filter lists only b:2
    When Inbox item b:1 is opened from the "All" filter
    Then Inbox item b:1 is no longer unread
    When Inbox item b:2 is resolved
    Then the Inbox "Blocked" filter is empty

  @scenario:backlog.items-grouping
  Scenario: Group the Items table by kind and collapse a group
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "bug: grouped crash" is captured
    And "idea: grouped dashboard" is captured
    And the Items view is opened
    When the Items view is grouped by "Kind"
    Then the Items view shows a "Bug" group and an "Idea" group
    When the "bug" group is collapsed
    Then the Items view hides "grouped crash" and keeps "grouped dashboard"

  @scenario:backlog.projects-overview
  Scenario: Read a project's progress and open its items
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Filed under the project" is captured
    And backlog item b:1 is assigned to a registered project from its feed context menu
    And the Projects view is opened
    Then the project card for the registered project counts 0 of 1 done
    When the registered project is opened from Projects
    Then the project page lists "Filed under the project"
    When the project page goes back to all projects
    Then the Projects overview is shown

  @scenario:backlog.search-operators
  Scenario: Narrow a search with kind, tag, kind shorthand and id operators
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "bug: alpha crash #infra" is captured
    And "idea: alpha dashboard" is captured
    And "alpha cleanup" is captured
    Then searching "alpha" lists 3 results
    And searching "alpha kind:bug" lists only "alpha crash"
    And searching "#infra" lists only "alpha crash"
    And searching "alpha is:idea" lists only "alpha dashboard"
    And searching "b:3" lists only "alpha cleanup"

  @scenario:backlog.saved-views
  Scenario: Save a search as a view, reapply it from another view and delete it
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "alpha saved search target" is captured
    And "unrelated entry" is captured
    And the backlog is searched for "alpha"
    When the current search is saved as the Backlog view "Alpha work"
    And the Board view is opened after clearing the search
    And the saved Backlog view "Alpha work" is applied
    Then the saved view reopens the Feed filtered to "alpha saved search target"
    When the saved Backlog view "Alpha work" is deleted
    Then no saved views are listed

  @scenario:backlog.composer-autocomplete
  Scenario: Complete a tag and an item reference while capturing
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Tagged first #infra" is captured
    When "Follow-up for #inf" is typed in the capture box
    Then the capture suggestions offer "#infra"
    When the capture suggestion "#infra" is picked
    And " and @Tagged" is typed in the capture box
    Then the capture suggestions offer "Tagged first"
    When the capture suggestion "Tagged first" is picked
    And the capture is sent
    Then backlog item b:1 is referenced by "Follow-up for #infra and b:1"

  @scenario:backlog.composer-retry
  Scenario: A capture the Host refuses comes back with Retry
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And the next capture of "Retry this capture" fails on the Host
    And "Retry this capture" is typed in the capture box
    And the capture is sent
    Then the capture box keeps "Retry this capture" and offers Retry
    When the capture is retried
    Then the feed shows "Retry this capture" without a capture error

  @scenario:backlog.inspector-pickers
  Scenario: Change kind and status, add and remove a link in the inspector
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Inspect me" is captured
    And backlog item b:1 is opened
    When the "Kind" of b:1 is set to "Bug" in the inspector
    And the "Status" of b:1 is set to "Todo" in the inspector
    Then the inspector shows b:1 as a "Bug" in "Todo"
    When the link "https://example.com/spec" is added in the inspector
    Then the inspector lists the link "example.com/spec"
    When the link "https://example.com/spec" is removed in the inspector
    Then the inspector no longer lists the link "example.com/spec"

  @scenario:backlog.proposal-accept-dismiss
  Scenario: Accept one triage suggestion and dismiss another
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts, @dshfiles/settings-shell" is booted
    When the Backlog panel is opened
    And Backlog automatic triage is configured to use the local fake model
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And a low-confidence fake triage suggestion titled "Accepted suggestion title" is captured
    And a low-confidence fake triage suggestion titled "Dismissed suggestion title" is captured
    And the Backlog Inbox is opened
    Then the Inbox "Suggestions" filter lists b:1 and b:2
    When the triage suggestion on b:1 is accepted
    Then backlog item b:1 is titled "Accepted suggestion title" without a suggestion
    When the triage suggestion on b:2 is dismissed
    Then backlog item b:2 keeps its title without a suggestion
