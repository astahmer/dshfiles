Feature: jj thread workspaces

  These journeys register a disposable jj repository as a project through the
  real New thread picker. The Host provisions, discards and lands thread
  workspaces in that repository; the agent's edits are stood in for by the jj CLI.

  @scenario:jj-integration.destination-browser-journey
  Scenario: Choose where a new thread runs from the destination bar
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
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

  @scenario:jj-integration.new-thread-background-browser-journey
  Scenario: New thread opens its composer at once and gets its own workspace in the background
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/home, @dshfiles/thread-sidebar, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And a first message is sent from the shared checkout
    And new threads start in their own jj workspace by default
    And New thread is clicked in the sidebar
    Then the New thread composer opens before its workspace exists
    And the New thread moves to its own jj workspace on "main" in the background

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

  @scenario:jj-integration.land-browser-journey
  Scenario: Land a thread's described work onto main
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    Then Land waits for work in the thread
    When the thread workspace gains a revision described "wip"
    Then Land refuses the placeholder description and leaves main in place
    When the thread workspace gains a revision described "Add the landed feature"
    Then Land moves main onto the work described "Add the landed feature"

  @scenario:jj-integration.discard-browser-journey
  Scenario: Discard a thread workspace and its work from the Thread workspaces panel
    Given the isolated plugin composition of "@dshfiles/jj-integration, @dshfiles/workspace-folder-picker, @dshfiles/multi-host" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Work nobody wants"
    And the Thread workspaces panel is opened
    Then the thread row offers Land for its 1 unlanded revision
    When "Discard with work" is chosen from the thread row's More menu
    Then the confirmation names the thread and its 1 unlanded revision
    When the discard is confirmed
    Then the thread workspace is gone from jj and from the panel
