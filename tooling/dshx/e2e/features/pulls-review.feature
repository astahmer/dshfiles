Feature: pulls.review thread review scopes

  A thread owns a jj workspace, so the plugin reads `jj diff --from <base> --to @`
  through the Host and groups it with pulls.review's rule-based scopes. The
  `/pulls` command reports the same grouping as text in the thread.

  @scenario:pulls-review.thread-scopes
  Scenario: Read the thread workspace's changes as review scopes
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/diff-viewed, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the /pulls command runs in the current thread
    Then the thread shows the pulls.review scope report
    When the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"

  @scenario:pulls-review.all-scopes-visible
  Scenario: Browse changed files from every scope in one review
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/diff-viewed, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the thread workspace holds changed files in different scopes
    And the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"
    Then every scope's file diffs appear in the same scrollable review

  @scenario:pulls-review.batch-reviewed
  Scenario: Mark selected files reviewed across scopes in one action
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/diff-viewed, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the thread workspace holds changed files in different scopes
    And the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"
    When all changed files are selected for batch review
    Then marking selected files reviewed updates progress across scopes

  @scenario:pulls-review.changes-facet
  @scenario:pulls-review.land-card
  @scenario:pulls-review.diff-line-comments
  @scenario:diff-viewed.revision-range-marks
  Scenario: Review a thread's changes in its Changes facet, comment on a line and land them
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/diff-viewed, @dshfiles/jj-integration, @dshfiles/jujutsu, @dshfiles/project-checks, @dshfiles/workspace-folder-picker, @dshfiles/multi-host, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    When a disposable jj repository is chosen as the New thread project
    And the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Add the feature"
    And the Changes facet is opened from the composer changes bar
    Then the Changes facet shows "Whole thread" with 1 changed file
    And the Changes facet reads "0/1 viewed"
    When "feature.txt" is marked viewed in the Changes facet
    Then the Changes facet reads "1/1 viewed"
    And the viewed mark of "feature.txt" survives a reload
    When line 1 of "feature.txt" is commented "Name the feature after its job"
    Then the composer holds the line comment chip "feature.txt:1"
    And the Land card offers to land 1 revision on "main"
    When the work described "Add the feature" is landed from the Land card
    Then main moves onto the work described "Add the feature" and the Land card has nothing left

  @scenario:pulls-review.turn-card-opens-changes
  Scenario: A turn's Edited files card opens the Changes facet on that turn
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/diff-viewed, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes "alpha.txt" and "beta.txt" in a fresh review workspace
    And the Edited files card of turn 1 is opened
    Then the Changes facet shows "This turn" with 2 changed files
    When "alpha.txt" is marked viewed in the Changes facet
    Then the Changes facet reads "1/2 viewed"
    And the Changes journey is complete
