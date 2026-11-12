Feature: Thread view presets

  These journeys use a fresh isolated Host profile with no provider credentials.
  View presets and control visibility are changed only through the real sidebar UI.

  @scenario:thread-sidebar.custom-views
  Scenario: Customize named thread views and hide their quick controls
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When saved thread views are created, edited, reordered, disabled, and removed
    Then the custom tabs and hidden controls survive reload

  @scenario:thread-sidebar.view-context-menu
  Scenario: Mark every thread in a view read or unread from its context menu
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When a view context menu marks a thread unread
    Then the same view context menu marks it read

  @scenario:thread-sidebar.filter-presets
  Scenario: Save filter presets and switch between them
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/command-palette, @dshfiles/shortcuts" is booted
    When two filter presets are saved from the Filter menu
    Then the presets switch from the Filter menu, the command palette and the bracket keys
    And an edited preset saves its changes and a deleted preset comes back with Undo
