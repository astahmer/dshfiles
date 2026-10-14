Feature: Goal stall guard

  A loopback Command Code fake answers every round of a goal whose objective
  carries the `[[empty]]` directive with reasoning and no answer. AI Accounts
  retries that empty response and then fails the turn, which leaves the goal
  inactive; each resume runs one more empty round.

  @scenario:goal-stall-guard.threshold
  Scenario: A goal whose rounds keep coming back empty is paused on the third
    Given the isolated plugin composition "@dshfiles/goal-stall-guard" and "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a goal whose rounds come back empty is set in a new thread
    Then the empty round fails and leaves the goal inactive
    When the goal is resumed and its round comes back empty again
    Then the goal is still only inactive
    When the goal is resumed and its round comes back empty again
    Then the guard pauses the goal after its third empty round

  @scenario:goal-stall-guard.unavailable-goal
  Scenario: Empty turns outside a goal are left alone
    Given the isolated plugin composition "@dshfiles/goal-stall-guard" and "@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And three messages that come back empty are sent in a new thread without a goal
    Then each turn fails on its own and no goal appears
