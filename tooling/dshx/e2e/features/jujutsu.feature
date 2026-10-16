Feature: Jujutsu revision interactions

  These journeys use a disposable local JJ repository and the real isolated
  plugin profile. Mutation previews are cancelled before any repository change.

  @scenario:jujutsu.graph-navigation
  Scenario: Landmarks, exact relationships and reversible graph views
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu navigation repository is selected
    Then landmarks and relationships navigate without mutating history
    And graph focus and hide can be undone without losing shared history

  @scenario:jujutsu.drag-drop-preview
  Scenario: revision and bookmark moves preview in the target context
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository is selected
    Then revision and bookmark moves preview in the target context without changing history

  @scenario:jujutsu.stale-repository-recovery
  Scenario: a missing repository offers a direct recovery path
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository is selected
    Then removing the selected repository offers a way to choose another

  @scenario:jujutsu.copy-ids
  Scenario: revision context menu copies the displayed revision ID
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository is selected
    Then the revision context menu copies the displayed revision ID

  @scenario:jujutsu.graph-filters
  Scenario: Search, author and immutability filters narrow the revision graph
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    Then searching, filtering by author and hiding immutable revisions narrow the graph

  @scenario:jujutsu.refresh-behavior
  Scenario: Outside changes appear on refresh and when the page becomes visible
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a revision "Committed outside once" is committed outside DSH
    Then "Committed outside once" appears only after a manual refresh
    When a revision "Committed outside twice" is committed outside DSH
    Then "Committed outside twice" appears when the page becomes visible again

  @scenario:jujutsu.diff-review
  Scenario: Review a revision's changed files and full diff
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And the Feature revision is opened
    Then its changed files keep literal paths and track review progress

  @scenario:jujutsu.preview-confirm
  Scenario: A squash runs only from a fresh preview
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And the Feature revision is opened
    And the Feature revision is previewed for squashing into its parent
    And a revision "Moved the repository on" is committed outside DSH
    And the squash preview is confirmed
    Then the stale preview is refused without changing the repository
    When the Feature revision is opened
    And the Feature revision is previewed for squashing into its parent
    And the squash preview is confirmed
    Then the Feature revision is squashed into Base

  @scenario:jujutsu.composer-context
  Scenario: One composer chip summarizes the thread's repository context
    Given the isolated plugin composition "@dshfiles/jujutsu" and "@dshfiles/workspace-folder-picker" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And the repository is registered and a thread is started in it
    Then the composer dock shows one repository, workspace and bookmark chip

  @scenario:jujutsu.workspace-session
  Scenario: Provision a workspace at a revision and open a session there on request
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a workspace "review-ws" is provisioned at the Feature revision under the fixture root
    Then the workspace "review-ws" exists and a session opens in it only when asked
