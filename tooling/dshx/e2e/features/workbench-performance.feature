@workbench-performance
Feature: Controlled Workbench thread-switch performance

  This scratch comparison repeats the same unified Workbench with two real
  threads and real sidebar input. It records local measurements, not a renderer
  comparison, optimization result or live-Host performance claim.

  @scenario:workbench.switch-performance
  Scenario: Repeated unified Workbench runs keep the same thread-switch budget
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And six real sidebar switches are measured for the "baseline" run
    And the unified Workbench is ready
    And six real sidebar switches are measured for the "repeat" run
    Then the scratch Workbench switch comparison is attached and has no stable regression
    And the workbench main acceptance journey is complete
