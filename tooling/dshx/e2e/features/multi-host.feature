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
    And the native composer sends a prompt to the remote Session
    Then the new thread is owned by the automatically selected remote runtime

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
  @scenario:multi-host.remote-inventory
  Scenario: A thread started on the host appears in the manager's inventory
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a thread is started directly on the scratch remote
    Then the manager lists it as started on the host
