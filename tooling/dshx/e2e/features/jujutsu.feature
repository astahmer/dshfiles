Feature: Jujutsu revision interactions

  These journeys use a disposable local JJ repository and the real isolated
  plugin profile. Mutation previews are cancelled before any repository change.

  @scenario:jujutsu.drag-drop-preview
  Scenario: revision and bookmark moves preview in the target context
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository is selected
    Then revision and bookmark moves preview in the target context without changing history

  @scenario:jujutsu.copy-ids
  Scenario: revision context menu copies full IDs
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository is selected
    Then the revision context menu copies the exact change ID and commit ID
