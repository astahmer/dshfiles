Feature: Genuine terminals in every Workbench pane

  @scenario:workbench.terminal-picker-lifecycle
  Scenario: Native Session terminals launch from every picker and survive moves and reload
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And a disposable terminal workspace has a selected real conversation
    And the "main" pane opens a genuine terminal from its view picker
    Then the main terminal did not reveal the right pane
    When the other terminal destination panes are revealed
    And the "right" pane opens a genuine terminal from its view picker
    And the "left" pane opens a genuine terminal from its view picker
    And the "bottom" pane opens a genuine terminal from its view picker
    Then the four terminal views have independent native shells and buffers
    When the first terminal moves through every Workbench pane
    And the Workbench main page is reloaded
    Then the same terminal identities and shell processes recover without new allocation
    When every terminal tab is explicitly closed
    Then the native terminal owner has removed its records and stopped those shells
    And the workbench main acceptance journey is complete
