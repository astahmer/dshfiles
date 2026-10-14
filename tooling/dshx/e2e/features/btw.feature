Feature: /btw side chat

  A local fake Command Code provider answers every turn, so the side chat
  runs a real fork, model selection and turn without a network.

  @scenario:btw.btw-side-chat
  Scenario: Ask a side question in a right-sidebar fork, then close it
    Given the isolated plugin composition of "@dshfiles/btw, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "first question"
    And "/btw what was my first question?" is sent from the thread composer
    Then a side chat tab answers on the thread's model while the thread keeps one message
    When the side chat tab is closed
    Then the side chat tab is gone
