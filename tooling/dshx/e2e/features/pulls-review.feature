Feature: pulls.review thread review scopes

  A thread owns a jj workspace, so the plugin reads `jj diff --from <base> --to @`
  through the Host and groups it with pulls.review's rule-based scopes.

  @scenario:pulls-review.thread-scopes
  Scenario: Read the thread workspace's changes as review scopes
    Given the isolated plugin composition of "@dshfiles/pulls-review, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    And a message is sent in the thread workspace
    And the pulls.review panel is opened from the sidebar
    Then the pulls.review panel reads the thread workspace against "main"
