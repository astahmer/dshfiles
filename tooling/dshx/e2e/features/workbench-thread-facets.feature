Feature: Thread facets in every Workbench pane

  @scenario:workbench.thread-facets-follow
  Scenario: The right pane chooser opens Cost and Jobs for the thread on screen and they follow thread switches
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/usage, @dshfiles/background-jobs" is booted
    When the unified Workbench is ready
    And a disposable terminal workspace has a selected real conversation
    And the "right" pane opens the "Cost" thread facet from its view chooser
    And the "right" pane opens the "Jobs" thread facet from its view chooser
    Then the "right" pane shows the "Cost" and "Jobs" facets for the thread on screen
    When another thread comes on screen
    Then the "right" pane shows the "Cost" and "Jobs" facets for the thread on screen
    And the workbench main acceptance journey is complete

  @scenario:workbench.thread-facets-closed-tab
  Scenario: Open thread facets show no thread once the thread's tab is closed
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/usage, @dshfiles/background-jobs" is booted
    When the unified Workbench is ready
    And a disposable terminal workspace has a selected real conversation
    And the "right" pane opens the "Cost" thread facet from its view chooser
    And the "right" pane opens the "Jobs" thread facet from its view chooser
    Then the "right" pane shows the "Cost" and "Jobs" facets for the thread on screen
    When the tab of the thread on screen is closed
    Then the "right" pane shows the "Cost" and "Jobs" facets without a thread

  @scenario:workbench.thread-facets-host-restart
  Scenario: Choose a view offers the Context facet and open facets come back with content after a Host restart
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/usage, @dshfiles/background-jobs, @dshfiles/agent-toolkit" is booted
    When the unified Workbench is ready
    And a disposable terminal workspace has a selected real conversation
    And the "right" pane opens the "Context" thread facet from its view chooser
    And the "right" pane opens the "Jobs" thread facet from its view chooser
    And the scratch Host restarts with the facets open
    Then the "right" pane restores the "Context" and "Jobs" facets with content
