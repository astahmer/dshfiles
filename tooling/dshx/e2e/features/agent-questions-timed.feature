Feature: Root timed ask_user_question

  A root Agent asks a timed question through DSH's own `tool-ask-user` in the
  web seed's `mode: timed`. The model is the loopback fake Command Code provider,
  so no external provider, live profile or user workspace is used.

  @scenario:agent-questions.root-timed-question
  @scenario:agent-questions.question-card-countdown
  Scenario: A timed question counts down, returns pending, and accepts a late answer
    Given the isolated Agent Questions composition with timed questions is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks a timed question in a fresh workspace
    Then the question card counts down with a steady countdown while the Agent waits
    And the wait ends pending while the question stays answerable
    When the pending question is answered "Production"
    Then the Agent receives the late answer "Production" as a user-question reply

  @scenario:agent-questions.root-timed-question-cancel
  Scenario: Stopping the turn cancels a timed question that is still counting down
    Given the isolated Agent Questions composition with timed questions is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks a timed question with a long wait in a fresh workspace
    And the turn is stopped while the question counts down
    Then the question card is no longer answerable

  @scenario:agent-questions.root-timed-question-restart
  Scenario: A pending timed question after a Host restart
    Given the isolated Agent Questions composition with timed questions is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks a timed question in a fresh workspace
    And the wait ends pending while the question stays answerable
    And the scratch Host restarts and the thread is reopened
    Then the pending question card survives the restart
