Feature: Workbench long conversation scrolling

  @scenario:workbench.long-conversation-scroll
  Scenario: Long fixed conversations keep their real composer reachable through scrolling switching and reload
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And the second Workbench conversation receives a long history message
    Then the long Workbench chat scrolls within its pane with its original editable input
    When the long Workbench conversation is switched away and restored
    Then the long Workbench chat scrolls within its pane with its original editable input
    When the Workbench main page is reloaded
    Then the long Workbench chat scrolls within its pane with its original editable input
    And the workbench main acceptance journey is complete
