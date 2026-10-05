Feature: Client plugin boot integrity

  A client plugin activates against services other packages provide, so contracts
  broken between packages surface only in the browser. These scenarios assert the
  native readiness signal, expected manifest entries, and Slot rendering against
  real DSH profiles instead of inferring success from a missing card. Failure
  card parsing has direct unit coverage.

  Background:
    Given the web profile is booted

  Scenario: The shipped Web UI mounts every client plugin
    Then the Web UI mounts without a plugin failure card

  Scenario: No Slot fell back to its error boundary
    Then no Slot fell back to its error boundary

  Scenario: The Host shuts down when the scenario ends
    Then the Web UI is torn down cleanly
