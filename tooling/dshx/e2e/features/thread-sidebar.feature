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

  @scenario:thread-sidebar.park-context-menu
  Scenario: Park a thread from its context menu and keep it parked
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is parked from its context menu
    Then the Host thread stays parked after reload without an attention error

  @scenario:thread-sidebar.classification
  Scenario: Blank Host sessions stay out of classified thread rows
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a blank Host thread is started
    And the Active section is folded and reopened
    Then the sidebar keeps the blank session out of classified thread rows

  @scenario:thread-sidebar.session-header-actions
  Scenario: Pin a thread from the native session header overflow
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a nonblank Host thread is pinned from its session header overflow
    Then the thread stays pinned after reload

  @scenario:thread-sidebar.view-controls
  Scenario: Thread grouping and filters affect rows and survive reload
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When a Host thread is archived and the view is grouped and filtered
    Then only matching rows remain visible after reload

  @scenario:thread-sidebar.idle-archive
  Scenario: Auto-archive stays opt-in and saves its schedule
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When auto-archive is enabled with a new idle threshold and scan interval
    Then the policy settings survive a browser reload

  @scenario:thread-sidebar.manual-unread
  Scenario: Manual unread stays per-thread and clears on reopen
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When one thread is marked unread and another thread is opened
    Then its unread marker clears on open

  @scenario:thread-sidebar.auto-archive-overrides
  Scenario: Per-thread auto-archive overrides the global opt-in
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When auto-archive is enabled for one thread while global auto-archive stays off
    Then the per-thread override survives reload without changing the global setting

  @scenario:thread-sidebar.attention-colors
  Scenario: Attention status colors are configurable and saved
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When an attention status color is changed in Sidebar settings
    Then the selected attention color survives a browser reload

  @scenario:thread-sidebar.navigation-layout
  Scenario: Header destinations can be reordered and hidden
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When the header is expanded, reordered, and one destination is hidden
    Then the custom layout survives a browser reload

  @scenario:thread-sidebar.palette-search
  Scenario: Thread search reports an empty result from a fresh Host profile
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When the sidebar thread-search destination is opened with a nonmatching query
    Then the thread-sidebar palette shows no matching sessions

  @scenario:thread-sidebar.navigation-history
  Scenario: Back and Forward follow Host-created blank threads
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When two blank Host threads are opened
    Then Back and Forward return to the corresponding Host sessions

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
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    When the thread-sidebar command palette is searched for restart
    Then no restart action or confirmation appears without pending Host changes
