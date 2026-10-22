Feature: Tool activity appears under a finished turn

  A completed turn summarizes its real tool activity, and its failure count
  opens the failed command name and outcome.

  @scenario:turn-summary.failed-command
  Scenario: A failed bash command is summarized and can be inspected
    Given the isolated plugin composition of "@dshfiles/turn-summary, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model runs a failing bash command in a fresh workspace
    Then the finished turn names the failed command and its outcome
