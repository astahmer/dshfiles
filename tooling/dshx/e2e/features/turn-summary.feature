Feature: Tool activity appears under a finished turn

  A completed turn summarizes its real tool activity, and its failure count
  opens the failed command name and outcome.

  @scenario:turn-summary.failed-command
  Scenario: A failed bash command is summarized and can be inspected
    Given the isolated plugin composition of "@dshfiles/turn-summary, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model runs a failing bash command in a fresh workspace
    Then the finished turn names the failed command and its outcome

  @scenario:turn-summary.walkthrough
  Scenario: A turn that writes a file shows its walkthrough card
    Given the isolated plugin composition of "@dshfiles/turn-summary, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes a file in a fresh workspace
    Then the finished turn shows a walkthrough card naming the written file

  @scenario:turn-summary.edits-summarized-once
  Scenario: A turn that edits a file and runs a command names the edit only in its walkthrough card
    Given the isolated plugin composition of "@dshfiles/turn-summary, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes a file and runs a command in a fresh workspace
    Then the footer names the command and the walkthrough card alone names the edited file
    And the walkthrough card opens the edited file
