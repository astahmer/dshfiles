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

  @scenario:backlog.search-status-filter
  Scenario: Filter search results by one or several statuses
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "bug: composer chip in progress" is captured
    And "idea: composer chip in inbox" is captured
    When item b:1 is moved to In progress on the board
    And the backlog is searched for "composer chip"
    Then search results offer one count for each matching status
    When search is filtered by the "In progress" status
    Then search results list only "composer chip in progress"
    When search is also filtered by the "Inbox" status
    Then search results list both "composer chip in progress" and "composer chip in inbox"
    When the "In progress" status search filter is cleared
    Then search results list only "composer chip in inbox"
    When the "Inbox" status search filter is cleared
    Then search results list both "composer chip in progress" and "composer chip in inbox"

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

  @scenario:backlog.inline-edit
  Scenario: Rename an item in place from the feed, the Items table and the board
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Rename me in the feed" is captured
    When backlog item b:1 is double-clicked in the feed
    Then the feed edits item b:1 inline without opening it
    When the inline title is replaced with "Renamed in the feed"
    Then the feed titles item b:1 "Renamed in the feed"
    When the Items view is opened
    And backlog row b:1 is double-clicked in the Items view
    Then the Items view edits b:1 inline without opening it
    When the inline title is replaced with "Renamed in the table"
    Then the Items view titles b:1 "Renamed in the table"
    When the Board view is opened
    And backlog card b:1 is double-clicked on the board
    Then the board edits b:1 inline without opening it
    When the inline title is replaced with "Renamed on the board"
    Then the board card for b:1 is titled "Renamed on the board"

  @scenario:backlog.start-thread
  Scenario: Start a thread from a board card and stay in the backlog
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Ship the thread starter" is captured
    When backlog card b:1 is clicked
    And the Start thread button in the item detail is clicked
    Then the start thread dialog offers the account model and the Host default folder
    And the start thread dialog sends the prefilled message by default
    And the start thread dialog keeps the thread in the backlog by default
    When the thread is started from the dialog without a first message
    Then the backlog panel stays open while the thread is created
    When the Backlog panel is opened again
    And backlog item b:1 is opened
    Then the item links the thread it started as "Ship the thread starter"

  @scenario:backlog.start-thread-opens
  Scenario: Open the started thread when the dialog asks for it
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Open the thread starter" is captured
    When backlog card b:1 is clicked
    And the Start thread button in the item detail is clicked
    And the open-when-created box is checked
    And the thread is started from the dialog without a first message
    Then the thread composer is open for it

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
    And the open-when-created box is checked
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
    Then the board card for b:1 names the project it is filed under
    And backlog item b:1 exposes all context actions in the "details" view

  @scenario:backlog.item-text-links
  Scenario: Follow links in an item title and description
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And an item with linked title and description is captured
    Then item text links are clickable in the feed
    When the Items view is opened
    Then item title links are clickable in the Items view
    When the feed is shown
    And backlog item b:1 is opened
    Then item text links are clickable in the detail

  @scenario:backlog.reference-preview
  Scenario: Preview a referenced item from a conversation
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Ship the backlog reference preview" is captured
    When a thread on the fake model writes "Working on b:1"
    Then the inline backlog preview shows "Ship the backlog reference preview"
    When the backlog preview is opened in the Backlog panel
    Then the backlog detail shows "Ship the backlog reference preview"
