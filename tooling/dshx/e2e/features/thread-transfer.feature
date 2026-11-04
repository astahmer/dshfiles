Feature: Thread export and import

  A loopback Command Code fake answers a real turn. The thread is exported to a
  .dshthread download from the command palette and imported back as a new
  thread with a fresh id, which shows the same conversation.

  @scenario:thread-transfer.export
  Scenario: Export a thread to a bundle from the command palette
    Given the isolated plugin composition of "@dshfiles/thread-transfer, @dshfiles/ai-accounts, @dshfiles/command-palette" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "portable thread proof"
    And the thread is exported from the command palette
    Then a .dshthread bundle downloads with the thread's messages
    And the export journey is complete

  @scenario:thread-transfer.export-import
  Scenario: Import an exported bundle as a new thread
    Given the isolated plugin composition of "@dshfiles/thread-transfer, @dshfiles/ai-accounts, @dshfiles/command-palette" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "portable thread proof"
    And the thread is exported from the command palette
    Then a .dshthread bundle downloads with the thread's messages
    When the bundle is imported from the command palette into the home folder
    Then a new thread opens with "portable thread proof"
