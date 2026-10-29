Feature: Session warming

  With warming switched on in Settings at a one-minute interval, an idle
  thread's last request is sent again to the loopback Command Code fake for one
  output token, and no new turn appears in the thread.

  @scenario:session-warming.warm-idle-thread
  Scenario: An idle thread's last request is re-sent after the interval
    Given the isolated plugin composition of "@dshfiles/session-warming,@dshfiles/ai-accounts,@dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And session warming is switched on in Settings with a one-minute interval
    And a new thread on the fake model answers a first message
    Then the fake provider receives the same request again within ninety seconds
    And the thread still shows a single turn
