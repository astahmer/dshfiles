Feature: pulls.review thread review scopes

  A thread owns a jj workspace, so the plugin reads `jj diff --from <base> --to @`
  through the Host and groups it with pulls.review's rule-based scopes. The
  `/pulls` command reports the same grouping as text in the thread.

  @scenario:pulls-review.thread-scopes
  Scenario: Read the thread workspace's changes as review scopes
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the /pulls command runs in the current thread
    Then the thread shows the pulls.review scope report
    When the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"

  @scenario:pulls-review.batch-reviewed
  Scenario: Mark the whole scope reviewed from one batch action
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the thread workspace holds one changed file
    And the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"
    When the scope files are selected for batch review
    Then marking the selection reviewed marks every file reviewed
