Feature: New thread home screen

  The home bundle replaces the New thread branding and lists the project's
  recent threads and thread workspaces with work to land. The journey uses a
  disposable jj repository registered through the real project picker.

  @scenario:home.browser-journey
  Scenario: Brand the New thread screen and resume project work from it
    Given the isolated plugin composition "@dshfiles/home" and "@dshfiles/jj-integration" and "@dshfiles/workspace-folder-picker" is booted
    When a disposable jj repository is chosen as the New thread project
    Then the New thread headline names the project "repo" instead of the DeepSeek headline
    When the New thread headline is set to "Ship {project}" with the mark "🚀"
    Then the New thread screen shows the mark "🚀" and the headline "Ship repo"
    When the New thread workspace toggle is turned on
    And a message is sent in the thread workspace
    And the thread workspace gains a revision described "Unlanded feature"
    And a new thread is started from the sidebar
    Then the New thread screen offers to resume "jj integration land e2e thread" and reports one thread with work to land
    When recent threads are turned off in the New thread settings
    Then the New thread screen no longer offers to resume "jj integration land e2e thread"
    And the work to land opens the Thread workspaces panel
