Feature: Session undo

  A turn of the loopback Command Code fake writes a file in a jj project through
  `bash`. Undo removes the file and continues in a fork cut before the turn;
  redo brings the file and the original thread back.

  @scenario:session-undo.undo-redo-files
  Scenario: Undo removes a turn's file and redo restores it
    Given the isolated plugin composition of "@dshfiles/session-undo,@dshfiles/jj-integration,@dshfiles/ai-accounts,@dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is started in a scratch jj project
    And the thread asks bash to write "undo-proof.txt"
    Then the turn wrote "undo-proof.txt" in the project
    When the last turn is undone from the composer
    Then "undo-proof.txt" is gone and the undone prompt waits in the queue
    When the undone turn is redone from the composer
    Then redo restored "undo-proof.txt" in the project
    And the original thread shows its turn again

  @scenario:session-undo.rewind-to-first-turn
  Scenario: Rewind past two of three turns keeps the first turn's file, and redo brings the rest back
    Given the isolated plugin composition of "@dshfiles/session-undo,@dshfiles/jj-integration,@dshfiles/ai-accounts,@dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is started in a scratch jj project
    And the thread runs a turn that leaves "rewind-1.txt" in the project
    And the thread runs a turn that leaves "rewind-2.txt" in the project
    And the thread runs a turn that leaves "rewind-3.txt" in the project
    When the thread is rewound to before the turn that left "rewind-2.txt"
    Then only "rewind-1.txt" of the three files remains
    When the undone turn is redone from the composer
    Then redo restored "rewind-2.txt" and "rewind-3.txt" in the project
    And the original thread shows its turns again
