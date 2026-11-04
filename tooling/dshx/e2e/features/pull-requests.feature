Feature: Create a pull request from a thread

  The Host runs real jj against a seeded repository whose origin is a local
  bare Git remote, and a stub gh on its PATH answers sign-in, repository,
  pull-request lookup, create and view calls without reaching GitHub.

  @scenario:pull-requests.create-from-thread
  Scenario: Preview, confirm and link a pull request from the command palette
    Given the pull-requests composition with a jj repository and a stub gh is booted
    And a thread is started in the pull-request project
    When "Create pull request from this thread" is run from the command palette
    Then the pull-request dialog previews the commit above main with a drafted title
    When the pull request is pushed and created from the dialog
    Then the dialog shows the opened pull request linked to the thread
    And the bookmark is on the remote and the stub gh created and polled the pull request
