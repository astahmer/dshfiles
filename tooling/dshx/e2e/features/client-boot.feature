Feature: Client plugin boot integrity

  A client plugin activates against services other packages provide, so a
  contract broken between packages surfaces only in the browser: the Web UI
  replaces itself with a "Failed to load plugins" card naming whichever entries
  happened to be affected rather than the plugin that broke. That is a net for
  anything the static checks cannot see, so these scenarios assert the healthy
  path and the quality of the report when something does break.

  The defects this suite originally guarded are not staged here on purpose. A
  locale-namespace collision and a missing runtime service are both refused at
  build time now, so staging one would mean deliberately breaking the build, and
  a test that depends on a mutation surviving a rebuild is a test that rots.
  What is worth asserting is that a real profile mounts, and that a failure names
  the entry rather than a symptom.

  Background:
    Given the web profile is booted

  Scenario: The shipped Web UI mounts every client plugin
    Then the Web UI mounts without a plugin failure card

  Scenario: A boot failure names the entry that failed, not only the dependants
    Then every client entry that failed to activate is reported by id

  Scenario: No Slot fell back to its error boundary
    Then no Slot fell back to its error boundary

  Scenario: The Host shuts down when the scenario ends
    Then the Web UI is torn down cleanly