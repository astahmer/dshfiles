Feature: Running-thread limit

  @scenario:session-controller.turn-admission
  Scenario: A new turn waits for a free slot under the running-thread limit and can be started at once
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the running threads limit is set to 1 in Settings
    And one thread runs a long shell call
    And a second thread is sent a message
    Then the second thread waits for a free slot with how many are ahead
    When the waiting turn is started now
    Then the second thread no longer waits
