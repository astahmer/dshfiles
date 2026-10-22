Feature: Vitest runs render as test-results cards

  A real Vitest command in the selected workspace renders its parsed results in
  the bash tool card instead of leaving the reporter output as terminal text.

  @scenario:test-runs.card
  Scenario: A completed Vitest run shows its result summary and filters
    Given the isolated plugin composition of "@dshfiles/test-runs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model runs the test-runs Vitest suite in the selected workspace
    Then the finished tool call shows a Vitest results card
