Feature: jj thread workspaces

  These journeys register a disposable jj repository as a project through the
  real New thread picker. The Host provisions, discards and rebases thread
  workspaces in that repository; the agent's edits are stood in for by the jj CLI.

  @smoke
  @scenario:jj-integration.destination-browser-journey
  Scenario: Choose where a new thread runs from the destination bar
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    Then the destination bar offers the main bookmark in the shared checkout

  @scenario:jj-integration.home-relative-project-path
  Scenario: Browse and select a New thread project by its home-relative path
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen by its home-relative path
    Then the destination bar offers the main bookmark in the shared checkout
    When the New thread composer has a draft "Keep this draft" with an image and a file attached
    And the New thread workspace toggle is turned on
    Then the New thread runs in its own jj workspace on "main"
    And the composer keeps draft "Keep this draft" with its image and file in the isolated workspace
    When the New thread workspace toggle is turned off
    Then the blank thread returns to the shared checkout and its workspace is kept as a spare
    And the composer keeps draft "Keep this draft" with its image and file in the shared checkout
    When the New thread composer draft is cleared
    When the "release" bookmark is picked in the destination bar
    Then the New thread runs in its own jj workspace on "release"
    When No folder is chosen as the New thread project
    Then the destination bar offers neither a bookmark nor a workspace toggle

  @scenario:jj-integration.new-thread-from-thread-workspace-browser-journey
  Scenario: A blank thread returns to its owning project instead of inheriting a prior thread workspace
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    And new threads start in the shared checkout by default
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And New thread is clicked in the sidebar
    Then the blank new thread returns to the owning project checkout

  @scenario:jj-integration.new-thread-from-thread-workspace-isolation-browser-journey
  Scenario: A blank thread gets a fresh workspace instead of reusing the previous one
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And new threads start in their own jj workspace by default
    And New thread is clicked in the sidebar
    Then the blank new thread uses a different jj workspace from the previous thread

  @scenario:jj-integration.new-thread-background-browser-journey
  Scenario: New thread opens its composer at once and gets its own workspace in the background
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And a first message is sent from the shared checkout
    And new threads start in their own jj workspace by default
    And New thread is clicked in the sidebar
    Then the New thread composer opens before its workspace exists
    And the New thread composer remains editable while its workspace is prepared
    And the New thread moves to its own jj workspace on "main" in the background

  @scenario:jj-integration.new-thread-deferred-submit-browser-journey
  Scenario: A submitted message waits for background workspace allocation
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And a first message is sent from the shared checkout
    And new threads start in their own jj workspace by default
    And New thread is clicked in the sidebar
    When a message is submitted before the new thread workspace is ready
    Then the message is delivered from its new thread workspace

  @scenario:jj-integration.draft-handoff-browser-journey
  Scenario: Switching the thread destination carries the draft without leaving a stale copy
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And "Draft handoff regression" is typed in the New thread composer
    And the New thread workspace toggle is turned on
    Then the New thread composer contains "Draft handoff regression"
    When the New thread workspace toggle is turned off
    Then the New thread composer contains "Draft handoff regression"
    When the New thread workspace toggle is turned on
    Then the New thread composer contains "Draft handoff regression"
    When the carried draft is sent
    And New thread is clicked in the sidebar
    Then the New thread composer is empty and no consumed draft remains stored

  @scenario:jj-integration.structured-reference-handoff-browser-journey
  Scenario: Switching the thread destination preserves structured composer references
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/mentions, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And threads named "Mention target" and "Second thread" are started
    And a new thread composer types "@t:Mention"
    And the highlighted mention row is picked with the keyboard
    And the composer appends a reference to thread "Second thread"
    And the New thread workspace toggle is turned on
    And the New thread workspace toggle is turned off
    Then the composer holds two native reference chips

  @scenario:jj-integration.rebase-browser-journey
  Scenario: Rebase a thread's described work onto main
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    Then the current thread header identifies its jj workspace
    And Rebase is disabled before there are revisions to rebase
    When the thread workspace gains a revision described "wip"
    Then Rebase refuses the placeholder description and leaves main in place
    When the thread workspace gains a revision described "Add the feature"
    Then Rebase moves main onto the work described "Add the feature"
    When the thread workspace gains a revision described "Follow-up after a steer"
    Then Rebase detects the follow-up revision without reloading
    When the thread's work is rebased outside the UI
    Then Rebase reflects the external rebase without reloading

  @scenario:jj-integration.rebase-command-browser-journey
  Scenario: Rebase a thread from its composer command
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Rebase from command"
    When the rebase command is submitted in the thread composer
    Then the rebase command advances main and reports success

  @scenario:jj-integration.rebase-command-shared-checkout-browser-journey
  Scenario: The rebase command refuses a shared checkout
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace is kept in the shared checkout
    And a message is sent in the shared checkout
    Then the thread header has no Rebase button
    When the rebase command is submitted in the thread composer
    Then the rebase command refuses the shared checkout without moving main

  @scenario:jj-integration.thread-workspace-rebase-browser-journey
  Scenario: Thread workspaces update as soon as a rebase succeeds
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Panel rebase"
    And the Thread workspaces panel is opened
    Then the thread row offers Rebase for its 1 revision to rebase
    When Rebase is clicked in the thread workspace row
    Then the thread workspace row immediately shows that it is up to date

  @scenario:jj-integration.discard-browser-journey
  Scenario: Remove a thread workspace and explicitly abandon its work
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Work nobody wants"
    And the Thread workspaces panel is opened
    Then the thread row offers Rebase for its 1 revision to rebase
    When the conversation is opened from its workspace row
    And the Thread workspaces side panel is opened
    Then its Preview shows the latest message
    When "Remove workspace and work to rebase…" is chosen from the thread row's More menu
    Then the confirmation names the thread and its 1 revision to rebase
    When the removal is confirmed
    Then the thread workspace is gone from jj and from the panel
