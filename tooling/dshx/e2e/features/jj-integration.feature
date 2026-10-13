Feature: jj thread workspaces

  These journeys register a disposable jj repository as a project through the
  real New thread picker. The Host provisions, discards and lands thread
  workspaces in that repository; the agent's edits are stood in for by the jj CLI.

  @scenario:jj-integration.destination-browser-journey
  Scenario: Choose where a new thread runs from the destination bar
    Given the isolated plugin composition "@dshfiles/jj-integration" and "@dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    Then the destination bar offers the main bookmark in the shared checkout
    When the New thread workspace toggle is turned on
    Then the New thread runs in its own jj workspace on "main"
    When the New thread workspace toggle is turned off
    Then the blank thread returns to the shared checkout and its workspace is discarded
    When the "release" bookmark is picked in the destination bar
    Then the New thread runs in its own jj workspace on "release"
    When No folder is chosen as the New thread project
    Then the destination bar offers neither a bookmark nor a workspace toggle

  @scenario:jj-integration.land-browser-journey
  Scenario: Land a thread's described work onto main
    Given the isolated plugin composition "@dshfiles/jj-integration" and "@dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    Then Land waits for work in the thread
    When the thread workspace gains a revision described "wip"
    Then Land refuses the placeholder description and leaves main in place
    When the thread workspace gains a revision described "Add the landed feature"
    Then Land moves main onto the work described "Add the landed feature"
