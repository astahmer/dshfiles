Feature: /goto sidebar command

  The /goto composer command lists palette actions, registered panels and
  recent threads from the live Client, then opens the picked target.

  @scenario:sidebar-commands.panel-navigation
  @scenario:sidebar-commands.recent-sessions
  Scenario: Go to a panel, a recent thread or the palette
    Given the isolated plugin composition of "@dshfiles/sidebar-commands, @dshfiles/command-palette, @dshfiles/ai-accounts" is booted
    When a thread named "goto session alpha" is started and a blank one is opened
    And the /goto command is opened from the composer
    Then /goto offers palette actions, registered panels and only the nonblank recent thread "goto session alpha"
    And picking a panel, the thread and the palette action each opens its target

  @scenario:sidebar-commands.palette-capability
  Scenario: Without the command palette /goto offers no palette actions
    Given the isolated plugin profile "@dshfiles/sidebar-commands" is booted
    When the /goto command is opened from the composer
    Then /goto offers no palette actions

  @scenario:sidebar-commands.stale-target
  Scenario: A panel unregistered while /goto is open is reported as stale
    Given the isolated plugin composition of "@dshfiles/sidebar-commands, @dshfiles/ai-accounts" is booted
    When the /goto command is opened from the composer
    And the AI Accounts plugin is disabled from another tab
    Then picking the AI Accounts row reports a stale panel and stays put
