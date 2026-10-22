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
  Scenario: Search by description and ID, then filter by author and immutability
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    Then searching, filtering by author and hiding immutable revisions narrow the graph

  @scenario:jujutsu.revision-date
  Scenario: Graph rows date a revision by its last content edit, not its creation
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a revision "Started long ago" created in 2020 is edited outside DSH today
    Then its row shows the edit, the creation, or both as the Revision date setting selects

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
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And the repository is registered and a thread is started in it
    Then the composer dock names the project, thread workspace and bookmark in one chip

  @scenario:jujutsu.workspace-session
  Scenario: Provision a workspace at a revision and open a session there on request
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a workspace "review-ws" is provisioned at the Feature revision under the fixture root
    Then the workspace "review-ws" exists and a session opens in it only when asked

  @scenario:jujutsu.chat-references
  Scenario: An explicit reference in an answer opens its revision
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a Command Code account backed by a local fake provider is added
    And the repository is registered and its thread answers "[[answer Trunk is `jj:main` here]]"
    Then hovering the reference previews the revision graph around it
    And clicking the reference opens the panel focused on that revision
    And the Agent prompt tells it to write Jujutsu references with the jj: prefix

  @scenario:jujutsu.workspace-cleanup
  Scenario: The repository menu previews a background cleanup before removing anything
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/jj-integration" is booted
    When a disposable Jujutsu repository is selected
    And the repository actions menu opens the workspace cleanup
    Then a custom cleanup threshold previews workspaces without removing anything
