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

  @scenario:btw.ask-entry-points
  Scenario: Open the side question from the palette, the shortcut and the composer chip
    Given the isolated plugin composition of "@dshfiles/btw, @dshfiles/ai-accounts, @dshfiles/command-palette" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "first question"
    And the side question is opened from the command palette
    Then the side question dialog from the palette is about the thread and cancels without a fork
    When the side question is opened with its shortcut
    Then the side question dialog from the shortcut is about the thread and cancels without a fork
    When the side question is opened from the composer chip
    And "what was my first question?" is asked in the side question dialog
    Then a side chat tab answers on the thread's model while the thread keeps one message
    When the side chat tab is closed
    Then the side chat tab is gone
