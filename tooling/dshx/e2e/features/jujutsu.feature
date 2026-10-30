Feature: Jujutsu revision interactions

  These journeys use disposable local repositories and the real isolated
  plugin profile. Opening a Git-only checkout initializes JJ; revision and bookmark
  previews are cancelled, while workspace moves affect only the disposable fixture.

  @scenario:jujutsu.git-auto-init
  Scenario: Opening a dirty Git-only checkout initializes JJ once and preserves Git history and file bytes
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable dirty Git-only checkout is opened through the Jujutsu repository picker
    Then the imported Git commit is visible and JJ metadata exists without changing Git history or dirty file bytes
    And reselecting and reopening the Git checkout does not initialize JJ again

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

  @scenario:jujutsu.workspace-overflow-drag
  Scenario: Move an overflow workspace from a shared revision
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with six workspaces on one revision is selected
    Then an overflow workspace can be dragged to another revision and moved independently

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
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration, @dshfiles/pulls-review, @dshfiles/multi-host" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And the repository is registered and a thread is started in it
    Then the composer dock names the project, thread workspace and bookmark in one chip
    And the composer summary shows an exact revision count against main

  @scenario:jujutsu.workspace-session
  Scenario: Provision a workspace at a revision and open a session there on request
    Given the isolated plugin profile "@dshfiles/jujutsu" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a workspace "review-ws" is provisioned at the Feature revision under the fixture root
    Then the workspace "review-ws" exists and a session opens in it only when asked

  @scenario:jujutsu.chat-references
  Scenario: An explicit reference in an answer opens its revision
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/multi-host" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And two Jujutsu bookmarks have long titles
    And a Command Code account backed by a local fake provider is added
    And the repository is registered and its thread answers "[[answer Trunk is `jj:main` here; `jj:short-ref`; `jj:long-ref`]]"
    Then the two long-title JJ references use content-driven widths
    And hovering the reference previews the revision graph around it
    And clicking the reference opens the panel focused on that revision
    And the Agent prompt tells it to write Jujutsu references with the jj: prefix

  @scenario:jujutsu.chat-references-foreign-repository
  Scenario: A reference to a revision of another registered repository previews and opens that repository
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/workspace-folder-picker, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/multi-host" is booted
    When a disposable Jujutsu repository with two authors is opened in the Jujutsu panel
    And a second disposable Jujutsu repository has a bookmark "foreign-ref" on "Foreign only revision"
    And a Command Code account backed by a local fake provider is added
    And both repositories are registered and the first repository's thread answers "[[answer Elsewhere it is `jj:foreign-ref` only]]"
    Then hovering the foreign reference previews its revision graph from the other repository
    And clicking the foreign reference opens the panel on the other repository focused on that revision

  @scenario:jujutsu.workspace-cleanup
  Scenario: Cleanup removes an older-page workspace and refreshes its graph label
    Given the isolated plugin composition of "@dshfiles/jujutsu, @dshfiles/jj-integration, @dshfiles/home, @dshfiles/multi-host, @dshfiles/workspace-folder-picker" is booted
    When a disposable Jujutsu cleanup repository with an empty older-page workspace is selected
    Then the empty workspace label appears on its older main ancestor
    And two stale untracked folders exist beside the repository
    And the repository actions menu opens the workspace cleanup
    Then the cleanup dialog shows age presets without removing anything
    When one stale untracked folder and the older-page workspace are selected for cleanup
    Then cleanup removes only the selected folder and clears the old graph workspace label without reloading
