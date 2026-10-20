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
    Then the board columns follow the status order through Dropped
    And the In progress column holds "Child step, part of b:1"
    When backlog item b:1 is opened
    Then it is referenced by "Child step, part of b:1"
    When the backlink to b:2 is followed
    Then its activity records the move "inbox → doing" by the user

  @scenario:backlog.status-filter
  Scenario: Read the feed by one status or several at once
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "bug: composer drops chips on paste" is captured
    And "idea: weekly digest of dormant items" is captured
    When item b:1 is moved to In progress on the board
    And the feed is filtered by the "In progress" status
    Then the feed narrows to "composer drops chips on paste"
    When the feed is also filtered by the "Inbox" status
    Then the feed shows both "composer drops chips on paste" and "weekly digest of dormant items"
    When the Items view is opened
    Then the Items view lists both "composer drops chips on paste" and "weekly digest of dormant items"
    When the feed is shown
    And the "Inbox" status filter is cleared
    Then the feed narrows back to "composer drops chips on paste"

  @scenario:backlog.start-thread
  Scenario: Start a thread for an item from its context menu
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Ship the thread starter" is captured
    When backlog item b:1 is right-clicked for a thread
    Then the start thread dialog offers the account model and the Host default folder
    And the start thread dialog sends the prefilled message by default
    When the thread is started from the dialog without a first message
    Then the thread composer is open for it
    When the Backlog panel is opened again
    And backlog item b:1 is opened
    Then the item links the thread it started

  @scenario:backlog.multi-select
  Scenario: Select item ranges and apply batch updates
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "First selection item" is captured
    And "Second selection item" is captured
    And "Third selection item" is captured
    When the Items view selects a range and toggles one item
    Then the batch status action updates only the remaining selected items


  @scenario:backlog.start-thread-draft
  Scenario: Start a thread with the first message left as a draft
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Draft the thread starter" is captured
    When backlog item b:1 is right-clicked for a thread
    And the send-now box is unchecked
    And the thread is started from the dialog with its message kept
    Then the thread composer holds "Work on b:1: Draft the thread starter" as a draft

  @scenario:backlog.item-context-actions
  Scenario: Right-click actions follow items across backlog views
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Context menu target" is captured
    When backlog item b:1 is moved to "In progress" from its feed context menu
    Then backlog item b:1 exposes all context actions in the "feed" view
    And backlog item b:1 exposes all context actions in the "items" view
    And backlog item b:1 exposes all context actions in the "board" view
    And backlog item b:1 exposes all context actions in the "search" view
    When backlog item b:1 is marked "Blocked" from its feed context menu
    Then backlog item b:1 exposes all context actions in the "inbox" view
    And backlog item b:1 exposes all context actions in the "projects" view
    When backlog item b:1 is assigned to a registered project from its feed context menu
    Then backlog item b:1 exposes all context actions in the "details" view
