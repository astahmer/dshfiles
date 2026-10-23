Feature: Shared input trigger engine

  The owned engine retains DSH's source pipeline and resolves @ tokens the
  way Codex's composer does: one whitespace-delimited token at the caret,
  with a quoted @" phrase for titles and paths with spaces.

  @scenario:input-trigger.quoted-multiword
  Scenario: The shared @ engine searches a quoted title phrase
    Given the isolated plugin profile "@dshfiles/mentions" is booted
    When threads named "deploy" and "fix the deploy script" are started
    And a new thread composer types "@\"fix the"
    Then a mention row includes the thread "fix the deploy script"
