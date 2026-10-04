Feature: Every plugin boots on its own

  Five plugins once sat in this repository with every check green and no way to
  mount: each called ctx.slots inside setup(ctx) without declaring inject, so the
  service was never injected and apply threw at browser boot. Typecheck cannot see
  it, the compiler's provider checks cannot see it, and a plugin nobody has
  enabled is never booted by anyone.

  So each plugin is booted alone, in a disposable profile, with its own Host. One
  at a time is the point: alongside nine others a broken plugin can be masked by
  whatever the rest happen to provide, and the failure then names a dependant
  rather than the cause.

  Background:
    Given each plugin is booted on its own

  Scenario Outline: A plugin mounts without a failure card
    When the plugin "<pluginId>" is opened
    Then the Web UI mounts without a failure card

  Examples:
    | pluginId                     |
    | @dshfiles/agent-communication |
    | @dshfiles/ai-accounts         |
    | @dshfiles/jujutsu            |
    | @dshfiles/mcp-servers         |
    | @dshfiles/plugin-marketplace  |
    | @dshfiles/queue-reorder       |
    | @dshfiles/secret-catalog      |
    | @dshfiles/settings-search     |
    | @dshfiles/shortcuts           |
    | @dshfiles/thread-sidebar      |