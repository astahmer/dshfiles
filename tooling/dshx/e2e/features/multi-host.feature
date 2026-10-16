Feature: Multi-host loopback SSH lifecycle

  This journey boots two repository-owned scratch DSH profiles behind a generated,
  loopback-only sshd. The manager composes @dshfiles/multi-host and @dshfiles/jj-integration
  to expose the host picker; it creates and reads a remote thread without external hosts.

  @scenario:multi-host.identity-profile
  @scenario:multi-host.ssh-connect
  @scenario:multi-host.ssh-identity-profile
  @scenario:multi-host.session-routing
  Scenario: Add a second scratch DSH and round-trip a remote thread
    Given a loopback SSH DSH pair is booted
    When the scratch remote is added from the host UI
    And a remote thread is created and read over SSH
    Then the second scratch DSH is ready and the remote thread round-trips
