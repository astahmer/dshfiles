Feature: Shared client runtime

  The client UI runtime is loaded as one shared bundle before dependent plugins.

  @scenario:shared-runtime.client-boot
  Scenario: The shared runtime mounts in an isolated profile
    Given the isolated plugin profile "@dshfiles/shared-runtime" is booted
    Then the Web UI mounts without a plugin failure card
