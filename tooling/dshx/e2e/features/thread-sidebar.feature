Feature: Thread sidebar journeys

  These journeys use a fresh isolated Host profile with no provider credentials.
  Blank sessions and settings are created or changed only through the real UI.

  @scenario:thread-sidebar.archive-undo
  Scenario: Undo a manual archive from its temporary notice
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is archived and immediately undone
    Then the thread is restored from the archive notice

  @scenario:thread-sidebar.archive-undo-preferences
  Scenario: Configure the manual archive undo notice
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When archive undo settings are changed and threads are archived
    Then archive undo settings control the temporary notice

  @scenario:thread-sidebar.archived-open-notice
  Scenario: Opening an archived thread restores it in one click
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When an archived thread is opened from the Archived section
    Then the thread is restored and open with no archived banner

  @scenario:thread-sidebar.settle
  Scenario: Settle a thread from its context menu and unsettle it to reply
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is settled from its context menu
    Then the thread is settled, opens read-only and unsettles to reply

  @scenario:thread-sidebar.board-view
  Scenario: Open the thread board as a page of columns with its own grouping and filters
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When separate remote threads are enabled and the thread board page is opened
    Then the board shows only columns, grouped and filtered independently from the sidebar list

  @scenario:thread-sidebar.continue-in-project
  Scenario: Continue a thread in another project and settle the original
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/workspace-folder-picker" is booted
    When a nonblank Host thread is continued in another registered project from its context menu
    Then the continuation opens in that project with the conversation and the original thread is settled

  @scenario:thread-sidebar.section-order
  Scenario: Keep remote threads with view groups by default or separate them
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When an archived thread and a settled thread fill the bottom sections
    Then separate remote grouping is opt-in, reorderable and persists across reloads

  @scenario:thread-sidebar.settled-auto-archive
  Scenario: A settled thread archives itself once its archive delay has passed
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a thread is settled with a one-week settled-archive delay
    Then the settled banner shows the archive time it is waiting for
    When the settled-archive delay is shortened to immediately
    Then the settled thread archives itself without a click

  @smoke
  @scenario:thread-sidebar.park-context-menu
  Scenario: Park a thread from its context menu and keep it parked
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is parked from its context menu
    Then the Host thread stays parked after reload without an attention error

  @scenario:thread-sidebar.section-drop
  Scenario: Drag a thread row into another section
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is parked from its context menu
    Then dragging its row onto the Active header unparks it and survives a reload

  @scenario:thread-sidebar.classification
  Scenario: Blank Host sessions stay out of classified thread rows
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a blank Host thread is started
    And the Active section is folded and reopened
    Then the sidebar keeps the blank session out of classified thread rows

  @scenario:thread-sidebar.session-header-actions
  Scenario: Pin a thread from the session header
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is pinned from its session header
    Then the thread stays pinned after reload

  @smoke
  @scenario:thread-sidebar.row-pin
  Scenario: Pin a thread from its sidebar row
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is pinned from its sidebar row
    Then the thread stays pinned after reload

  @scenario:thread-sidebar.multi-select
  Scenario: Extend a keyboard selection across threads and archive the batch
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When three nonblank Host threads fill the Active section
    And the first thread row is focused and Shift+ArrowDown selects the next two rows
    Then the sidebar shows three selected rows and their menu archives all of them
    And one Undo restores the archived batch

  @scenario:thread-sidebar.view-controls
  Scenario: Thread grouping and filters affect rows and survive reload
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a Host thread is archived and the view is grouped and filtered
    Then only matching rows remain visible after reload

  @scenario:thread-sidebar.idle-archive
  Scenario: Auto-settle stays opt-in and saves its schedule
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When auto-settle is enabled with a new idle threshold and scan interval
    Then the policy settings survive a browser reload

  @scenario:thread-sidebar.thread-mute
  Scenario: Snooze a thread until tomorrow morning, find it under Muted, and unmute it
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a thread is snoozed until tomorrow morning from its sidebar row
    Then it stays snoozed after reload and the Muted filter lists it
    And unmuting it from the session header clears the marker

  @scenario:thread-sidebar.manual-unread
  Scenario: Manual unread stays per-thread and clears on reopen
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When one thread is marked unread and another thread is opened
    Then its unread marker clears on open

  @scenario:thread-sidebar.turn-finished-attention
  Scenario: A finished turn keeps asking every tab for attention until it is opened
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a thread finishes its turn and the browser hands its unfinished marker to the Host
    Then every open tab shows the finished turn until one tab opens it

  @scenario:thread-sidebar.auto-archive-overrides
  Scenario: Per-thread auto-settle overrides the global opt-in
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When auto-settle is enabled for one thread while global auto-settle stays off
    Then the per-thread override survives reload without changing the global setting

  @scenario:thread-sidebar.attention-colors
  Scenario: Attention status colors are configurable and saved
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When an attention status color is changed in Sidebar settings
    Then the selected attention color survives a browser reload

  @scenario:thread-sidebar.notifications-settings
  Scenario: Configure category-specific notification routes and sounds
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When notification routes and sounds are configured in Settings
    Then previewing a notification sound plays a tone through the browser audio context
    And the notification settings survive a browser reload

  @scenario:thread-sidebar.navigation-layout
  Scenario: Header destinations can be reordered and hidden
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When the header is expanded, reordered, and one destination is hidden
    Then the custom layout survives a browser reload

  @scenario:thread-sidebar.footer-more-menu
  Scenario: The header and footer More menus both reach Settings and the pages
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When the sidebar footer More menu is opened
    Then the footer menu lists Settings and the sidebar pages and opens the Plugins page
    When the sidebar header More menu is opened
    Then the header menu offers Settings and Customize sidebar

  @scenario:thread-sidebar.palette-search
  Scenario: Thread search reports an empty result from a fresh Host profile
    Given the isolated plugin composition "@dshfiles/thread-sidebar" and "@dshfiles/command-palette" is booted
    When the sidebar thread-search destination is opened with a nonmatching query
    Then the thread-sidebar palette shows no matching sessions

  @scenario:thread-sidebar.navigation-history
  Scenario: Back and Forward follow Host-created threads
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When two Host threads are opened one after the other
    Then Back and Forward return to the corresponding Host sessions

  @scenario:thread-sidebar.keyboard-selection
  Scenario: Arrow keys move focus and Shift selects a range of threads
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When two nonblank Host threads are listed in the sidebar
    Then arrow keys move focus and Shift+ArrowDown selects a range of threads

  @scenario:thread-sidebar.children-links
  Scenario: Blank Host sessions do not expose child or link actions
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a blank Host thread is started
    Then no child rows or thread-link actions are offered for the blank session

  @scenario:thread-sidebar.mention-insertion
  Scenario: Mentioning a visible Host thread inserts a native chip at the captured cursor
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a visible Host thread is mentioned from its context menu at the captured cursor
    Then the composer contains the native mention chip at the captured cursor

  @scenario:thread-sidebar.restart-confirmation
  Scenario: No restart action is offered without pending Host changes
    Given the isolated plugin composition "@dshfiles/thread-sidebar" and "@dshfiles/command-palette" is booted
    When the thread-sidebar command palette is searched for restart
    Then no restart action or confirmation appears without pending Host changes

  @scenario:thread-sidebar.skill-mentions
  Scenario: Find a user-invocable skill through @ autocomplete
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted with the autocomplete skill fixture
    When the composer searches @ autocomplete for skill "e2e-skill-mentions"
    Then the skill "e2e-skill-mentions" appears as an @ suggestion

  @scenario:thread-sidebar.open-in-side-panel
  Scenario: Open a thread in the right side panel from its row menu, its hover action and the palette
    Given the isolated plugin composition "@dshfiles/thread-sidebar" and "@dshfiles/command-palette" is booted
    When a nonblank Host thread is opened in the side panel from its context menu
    Then the side panel hosts that thread's scrollable conversation and composer
    And the thread row offers the side-panel hover action
    When the side panel is closed and the same thread is opened from the command palette
    Then the side panel hosts that thread again
    When the side-panel hover action is switched off in Customize sidebar
    Then the thread row keeps the context-menu action but drops the hover one
    When the settle hover action is moved to the front in Customize sidebar
    Then the thread row draws the settle hover action first

  @scenario:thread-sidebar.referenced-by
  Scenario: See which thread references a thread from its row and header menus
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted with session content search
    When another thread references a visible Host thread from its composer
    Then both menus list the referencing thread under Referenced by

  @scenario:thread-sidebar.rename-thread-title
  Scenario: Rename a thread from its row menu and cancel an edit
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a thread title is renamed from its row menu and a second edit is cancelled
    Then the renamed thread title survives reload and the cancelled draft is discarded

  @scenario:thread-sidebar.jj-inventory-pauses-while-collapsed
  Scenario: A collapsed sidebar stops reading the JJ inventory
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    And the provider onboarding prompt is dismissed
    And the browser counts JJ inventory requests
    When the sidebar inventory pane is collapsed
    Then no JJ inventory request is made while the sidebar is collapsed
    Then the JJ inventory is read again after the sidebar expands
