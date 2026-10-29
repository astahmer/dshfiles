Feature: References

  A named outside directory is saved and attached with the /reference command;
  the next model request names it in the thread's runtime context. The loopback
  Command Code fake records the request messages.

  @scenario:references.attach-directory
  Scenario: A saved directory attached to a thread reaches the model request
    Given the isolated plugin composition of "@dshfiles/references,@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a new thread on the fake model answers a first message
    And the reference "docs" is saved from a scratch folder with the /reference command
    Then the command reports "docs" as saved and attached
    When the thread is sent another message
    Then the model request lists "docs" with its folder as an attached reference
