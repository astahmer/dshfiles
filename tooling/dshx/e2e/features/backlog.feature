Feature: Backlog

  The Backlog panel is one capture box over a feed ordered by activity and a
  board by status, with a peek beside them. These journeys use a fresh
  isolated profile and never call a model provider.

  @scenario:backlog.jev-settings-panel
  Scenario: Configure Jev from the Backlog panel
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And the Backlog settings are opened
    Then the Jev settings controls are available
    When Jev settings are saved with a secret reference
    Then the Jev settings show a successful save

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

  @scenario:backlog.search-filters-view
  Scenario: Typing a search filters the board in place and Enter opens all results
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "composer chip on the board" is captured
    And "weekly digest of dormant items" is captured
    And the Board view is opened
    When the backlog search is typed "composer"
    Then the board shows only the card for b:1
    When the backlog search is submitted
    Then search results list only "composer chip on the board"

  @scenario:backlog.board-column-preferences
  Scenario: Reorder and hide columns on the Backlog board only
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Keep board preferences local" is captured
    And the Board view is opened
    And the Inbox column is moved right and the Dropped column is hidden
    Then the board columns show the customized order without Dropped
    When the Items view is opened
    Then the Backlog items remain available outside the customized board

  @scenario:backlog.board-columns-browser-persistence
  Scenario: Board column preferences persist after a scratch Host restart
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Keep board preferences local" is captured
    And the Board view is opened
    And the default board columns are restored
    And the Inbox column is moved right and the Dropped column is hidden
    When the scratch Host is restarted in the browser
    And the Backlog panel is opened
    And the customized Board view is opened
    Then the board columns show the customized order without Dropped

  @scenario:backlog.board-links
  Scenario: Move an item on the board and follow its backlinks
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Parent epic" is captured
    And "Child step, part of b:1" is captured
    When item b:2 is moved to In progress on the board
    Then the board columns follow the status order through Dropped
    And the board columns do not scroll horizontally
    And the In progress column holds "Child step, part of b:1"
    When backlog item b:1 is opened
    Then the item detail can be resized without being cut off
    And it is referenced by "Child step, part of b:1"
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

  @scenario:backlog.project-detail-picker
  Scenario: Change an item's project from its details
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Change project from details" is captured
    And backlog item b:1 is opened
    When the project picker for item b:1 is opened
    Then the project choices are visible
    When item b:1 is assigned to the registered project from its details
    Then item b:1 shows its selected project
    When the project picker for item b:1 is opened
    And item b:1 is unassigned from its details
    Then item b:1 has no project

  @scenario:backlog.start-thread
  Scenario: Start a thread from a board card and stay in the backlog
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Ship the thread starter" is captured
    When backlog card b:1 is clicked
    And the Start thread button in the item detail is clicked
    Then the start thread dialog offers the account model and the Host default folder
    And the start thread dialog has no send-now toggle
    And the start thread dialog keeps the thread in the backlog by default
    When the thread is started from the dialog with the prefilled first message
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
    And the selected item's context menu moves all selected items to "Todo"
    Then the context menu status action updates all selected items
    When the remaining selection is made again
    Then the batch status action updates only the remaining selected items

  @scenario:backlog.board-multi-select
  Scenario: Select multiple board cards with modifier clicks and batch update them
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "First board selection" is captured
    And "Second board selection" is captured
    And "Third board selection" is captured
    When the Board view selects multiple cards with modifier clicks
    And the selected board card context menu moves all selected items to "Todo"
    Then the board context menu status action updates selected items

  @scenario:backlog.selection-visible-scope
  Scenario: Never batch an item hidden by a filter or collapsed group
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Hidden selection item" is captured
    And "Visible selection item" is captured
    And the Items view is opened
    And backlog selection is filtered after opening another item
    Then only the visible item is selected

  @scenario:backlog.selection-collapsed-scope
  Scenario: Collapsing a selected Items group removes its batch targets
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Hidden selection item" is captured
    And "Visible selection item" is captured
    And the Items view is opened
    Then collapsing the selected Inbox group clears its batch selection

  @scenario:backlog.board-multi-drag
  Scenario: Drag selected board cards together
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "First board selection" is captured
    And "Second board selection" is captured
    And "Third board selection" is captured
    When the Board view selects multiple cards with modifier clicks
    And the selected board cards are dragged to "todo"
    Then the board context menu status action updates selected items

  @scenario:backlog.board-drag-unselected
  Scenario: Dragging an unselected card does not move another selection
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "First board selection" is captured
    And "Second board selection" is captured
    And "Third board selection" is captured
    And only board card b:1 is selected
    And the selected board cards are dragged to "todo"
    Then only board card b:2 moved to Todo

  @scenario:backlog.multi-select-start-threads
  Scenario: Start one thread per selected backlog item
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "First selected work" is captured
    And "Second selected work" is captured
    And "Third selected work" is captured
    When the Items view selects a range and toggles one item
    And Start thread is clicked for the selection
    Then the start thread dialog offers both thread-count choices
    When one thread per item is chosen
    And the selected backlog threads are started
    Then the backlog reports that two threads were started

  @scenario:backlog.tweet-context-retrieval
  Scenario: Older tweet items offer context retrieval
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Tweet context in backlog https://x.com/someone/status/123" is captured
    Then backlog item b:1 offers tweet retrieval in its feed context menu

  @scenario:backlog.item-context-actions
  Scenario: Right-click actions follow items across backlog views
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Context menu target" is captured
    And "Nearest context target" is captured
    When ArrowUp is pressed from the empty backlog composer
    Then backlog item b:2 receives composer keyboard focus
    When backlog item b:1 copies its ID and link from the context menu
    And backlog item b:1 copies its Markdown from the context menu
    And backlog item b:1 is moved to "In progress" from its feed context menu
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
    And two images are attached to the capture
    And "Ship the backlog reference preview" is captured
    When a thread on the fake model writes "Working on b:1"
    Then the inline backlog preview shows "Ship the backlog reference preview"
    When an image is opened from the inline backlog preview
    Then the inline backlog preview gallery opens above its card and navigates both images
    When the backlog preview is opened in the Backlog panel
    Then the backlog detail shows "Ship the backlog reference preview"

  @scenario:backlog.sent-mention-chip
  Scenario: Render a sent backlog mention as its chip
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Ship the backlog reference preview" is captured
    When a message with the serialized backlog mention is sent
    Then the sent mention renders as a backlog chip "b:1" titled "Ship the backlog reference preview"

  @fake-secret-cli
  @scenario:backlog.jev-secret-setup
  Scenario: Offer a masked secret setup from chat when Jev has no key
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/secret-catalog, @dshfiles/ai-accounts, @dshfiles/settings-shell" is booted
    And a Command Code account backed by a local fake provider is added
    When Backlog Jev is enabled without a secret reference
    And a thread on the fake model writes "Reply briefly."
    Then the chat tail offers Jev secret setup
    When the Jev setup offer stores and binds a synthetic value
    Then Backlog stores only the secret reference for Jev
    And the Jev setup journey is complete

  @scenario:backlog.backfill-triage
  Scenario: Review the backlog triage backfill before it runs
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "An older capture to triage" is captured
    And the backlog backfill is opened
    Then the backfill dialog explains that it runs Jev and the configured triage model

  @scenario:backlog.rich-capture
  Scenario: Capture an item with image attachments
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And two images are attached to the capture
    And the image references are submitted with the capture
    Then the captured backlog item keeps both image attachments inline

  @scenario:backlog.rich-item-text
  Scenario: Save a Markdown description and reply
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Describe the issue" is captured
    And backlog item b:1 is opened
    And the item description is replaced with "**Observed** in the browser"
    Then the item detail shows the saved Markdown description
    When a comment "Confirmed in the scratch profile" is added
    Then the item activity shows the comment

  @scenario:backlog.reply-edit-delete-keyboard
  Scenario: Edit and delete a user reply with hover actions and keyboard access
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Reply with an image" is captured
    And backlog item b:1 is opened
    And a reply with an image is added
    When the user reply is edited with keyboard navigation
    Then the edited reply has only its replacement attachment
    When the user reply is deleted after confirmation
    Then the reply and its attachment are removed from the activity

  @scenario:backlog.smart-reply-routing
  Scenario: Route a work reply to a linked thread with in-app and browser notices
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts, @dshfiles/agents, @dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And Backlog uses a configured fake-model agent for replies
    And Backlog smart thread routing is enabled
    And Backlog notifications use both channels
    And Backlog AI reply answers are enabled
    And the Backlog panel is opened
    And "Improve the flaky test" is captured
    And backlog item b:1 is opened
    When a comment "Please fix the flaky test" is added
    Then the reply starts a linked work thread with an in-app and browser notice
    When a comment "Why is this flaky?" is added
    Then the discussion reply gets an AI answer without starting another thread

  @scenario:backlog.project-scope
  Scenario: Scope the feed to a project
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    Then the capture composer offers a project picker

  @scenario:backlog.attention-inbox
  Scenario: Find an item asking for input in the Inbox
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "Waiting for a decision" is captured
    And backlog item b:1 is marked "Needs you" from its feed context menu
    When the Backlog Inbox is opened
    Then the Inbox lists "Waiting for a decision" under "Needs you"

  @scenario:backlog.auto-triage
  Scenario: Apply a deterministic automatic triage proposal
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts, @dshfiles/settings-shell" is booted
    When the Backlog panel is opened
    And Backlog automatic triage is configured to use the local fake model
    And a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    When an item with a deterministic fake triage proposal is captured
    Then automatic triage applies the fake model title to the item

  @scenario:backlog.lifecycle-signals
  Scenario: Link a backlog item to a thread that mentions it
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Follow up on the deployment" is captured
    And a thread on the fake model writes "Working on b:1"
    When the Backlog panel is opened again
    And backlog item b:1 is opened
    Then the item detail links the thread that mentioned it

  @scenario:backlog.backlog-mentions
  Scenario: Complete a backlog item mention in a comment
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "A target for a composer reference" is captured
    And backlog item b:1 is opened
    When the comment box searches for the backlog item mention
    Then the comment suggestions include "A target for a composer reference"
    And the comment suggestions fit the viewport and scroll when needed
    When the backlog item mention is picked
    Then the comment box contains "b:1 "

  @scenario:backlog.shared-activity
  Scenario: Publish backlog changes to the Activity Timeline
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/activity-timeline" is booted
    When the Backlog panel is opened
    And "Shared timeline event" is captured
    And item b:1 is moved to In progress on the board
    When the Activity panel is opened from the Backlog journey
    Then the Activity Timeline shows the backlog creation and status change

  @scenario:backlog.capture-project-target
  Scenario: Capture an item from the current project
    Given the isolated plugin profile "@dshfiles/backlog" is booted
    When the Backlog panel is opened
    And "An item captured in the current project" is captured
    Then the captured item displays its project when one is available
