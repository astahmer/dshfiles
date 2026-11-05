Feature: Session reminders through the official Schedule service

  DSH 0.2.1 composes the Schedule service in the base web app and the
  schedule_* tools in the standard preset. A reminder the model creates in a
  thread comes back to that same thread as a follow-up turn.

  Scenario: A one-shot reminder is delivered to the thread that created it
    Given the isolated plugin composition of "@dshfiles/session-controller, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread asks the model to create a reminder due in 5 seconds
    Then the reminder prompt reaches the model as a new turn of that thread
