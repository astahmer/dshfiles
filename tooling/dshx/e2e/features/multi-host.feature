Feature: Multi-host loopback SSH lifecycle

  This journey boots repository-owned scratch DSH profiles behind a generated,
  loopback-only sshd. The manager composes multi-host, thread-sidebar,
  jj-integration, rich-composer, and the session-controller fork for mirrored Sessions,
  remote navigation, and the native composer.
  It verifies resource-aware Auto placement, remote Git clone and selected local-file transfer,
  remote composer ownership, tunnel recovery, stale launch rejection, profile-sync cleanup,
  lost-response reconciliation, and scratch cleanup.

  @scenario:multi-host.identity-profile
  @scenario:multi-host.ssh-connect
  @scenario:multi-host.ssh-identity-profile
  @scenario:multi-host.session-routing
  @scenario:multi-host.view-lease
  @scenario:multi-host.uncertain-mutation
  Scenario: Add a second scratch DSH and verify SSH lifecycle recovery
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a Git project is cloned with selected local files
    And a remote thread is created and read over SSH
    And the remote composer resolves @file suggestions on SSH
    And a remote file attachment is staged on its owning SSH host
    And the SSH tunnel drops and reconnects
    And stale SSH launch metadata is rejected
    And a failed scratch profile sync is cleaned without starting DSH
    And a lost mutation response is reconciled without replay
    And the remote DSH crashes and its scratch home is cleaned
    Then the scratch DSH readiness and recovery checks pass

  @scenario:multi-host.auto-destination
  Scenario: Auto chooses the registered remote host for a native new thread
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the native composer attaches a file through its picker
    And the native composer sends a prompt to the remote Session
    Then the new thread is owned by the automatically selected remote runtime
    And the picked file is stored by the owning remote host only

  @scenario:multi-host.local-path-refused
  @scenario:multi-host.remote-question
  Scenario: A remote agent's question is answered in the controlling chat
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    Then a message naming this machine is refused and keeps its draft
    When the remote agent asks a question
    Then the remote question opens in the controlling chat
    When the remote question is answered "Production" here
    Then the remote agent receives the answer "Production"

  @scenario:multi-host.remote-unopened-waiting
  Scenario: A remote thread that is not open here reports what it waits on
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the native composer sends a prompt to the remote Session
    And another remote thread that is not open here asks a question
    Then the unopened thread reports it is waiting and its question opens with it

  @scenario:multi-host.remote-question-reconnect
  Scenario: A waiting remote question survives a dropped tunnel
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the remote agent asks a question
    Then the remote question opens in the controlling chat
    When the connection to the remote drops while the question waits
    Then the remote question is back in the controlling chat after reconnecting
    When the remote question is answered "Production" here
    Then the remote agent receives the answer "Production"

  @scenario:multi-host.remote-question-dismissed
  Scenario: A remote agent's question is dismissed in the controlling chat
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the remote agent asks a question
    Then the remote question opens in the controlling chat
    When the remote question is dismissed here
    Then the remote agent learns the question was dismissed

  @scenario:multi-host.remote-question-timed
  Scenario: A remote agent's timed question counts down here and accepts a late answer
    Given a loopback SSH DSH pair with timed questions is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the remote agent asks a timed question lasting 12 seconds
    Then the remote question opens in the controlling chat
    And the remote question counts down with what its owner reports
    And the remote question stays answerable after its wait ends
    When the remote question is answered "Production" here
    Then the remote agent receives the answer "Production"

  @scenario:multi-host.remote-approval
  Scenario: A remote tool call is approved in the controlling chat
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the remote agent asks to run a command with wider access
    Then the remote approval opens in the controlling chat with its command
    When the remote approval is allowed once here
    Then the remote command runs on its owning host

  @scenario:multi-host.remote-jj
  Scenario: A remote thread's JJ workspace is read and integrated on its owner
    Given a loopback SSH DSH pair with JJ on the remote is booted
    When the scratch remote is added from the host UI
    And a thread on the remote has described work in its own JJ workspace
    Then this client reads that workspace from its owner and refuses any other path
    When a revision of that thread is described through the owner
    Then the revision panel shows that thread from its owner
    When the thread is integrated from this client
    Then the work is on the remote main bookmark

  @scenario:multi-host.remote-land-page
  Scenario: A remote thread is landed and removed from the Land page
    Given a loopback SSH DSH pair with JJ on the remote is booted
    When the scratch remote is added from the host UI
    And a thread on the remote has described work in its own JJ workspace
    And the thread is landed from the Land page
    Then the work reached the remote main bookmark
    And the workspace is removed from the Land page

  @scenario:multi-host.host-resources
  Scenario: The Hosts page shows live SSH resource pressure
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And the Hosts page is opened
    Then the Hosts page shows live resource metrics

  @scenario:multi-host.remote-host-fallback
  Scenario: A selected mirrored thread opens its owning host UI
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the native composer sends a prompt to the remote Session
    Then the new thread is owned by the automatically selected remote runtime
    And the mirrored thread opens its owning host UI
  @scenario:mentions.remote-thread-selection
  Scenario: A local composer can reference a recorded remote thread
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And Auto creates a thread through the remote folder picker
    And the remote model picker selects its model
    And the native composer sends a prompt to the remote Session
    Then the new thread is owned by the automatically selected remote runtime
    And the manager composer selects the recorded remote thread mention

  @scenario:multi-host.remote-inventory
  Scenario: A thread started on the host appears in the manager's inventory
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a thread is started directly on the scratch remote
    Then the manager lists it as started on the host
