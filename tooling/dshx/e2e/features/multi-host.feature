Feature: Multi-host loopback SSH lifecycle

  This journey boots two repository-owned scratch DSH profiles behind a generated,
  loopback-only sshd. The manager composes @dshfiles/multi-host and @dshfiles/jj-integration
  to expose the host picker; it verifies remote thread routing, tunnel recovery, stale launch
  rejection, profile-sync cleanup, lost-response reconciliation, and scratch cleanup.

  @scenario:multi-host.identity-profile
  @scenario:multi-host.ssh-connect
  @scenario:multi-host.ssh-identity-profile
  @scenario:multi-host.session-routing
  @scenario:multi-host.uncertain-mutation
  Scenario: Add a second scratch DSH and verify SSH lifecycle recovery
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a remote thread is created and read over SSH
    And the SSH tunnel drops and reconnects
    And stale SSH launch metadata is rejected
    And a failed scratch profile sync is cleaned without starting DSH
    And a lost mutation response is reconciled without replay
    And the remote DSH crashes and its scratch home is cleaned
    Then the scratch DSH readiness and recovery checks pass

  @scenario:multi-host.remote-inventory
  Scenario: A thread started on the host appears in the manager's inventory
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a thread is started directly on the scratch remote
    Then the manager lists it as started on the host
