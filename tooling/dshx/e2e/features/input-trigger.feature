Feature: Shared input trigger engine

  The owned engine retains DSH's source pipeline and accepts unquoted
  multiword @ lookups through the existing mentions source.

  @scenario:input-trigger.unquoted-multiword
  Scenario: The shared @ engine searches an unquoted title phrase
    Given the isolated plugin profile "@dshfiles/mentions" is booted
    When threads named "deploy" and "fix the deploy script" are started
    And a new thread composer types "@fix the"
    Then a mention row includes the thread "fix the deploy script"
