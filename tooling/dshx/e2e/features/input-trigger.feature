Feature: Shared input trigger engine

  The owned engine retains DSH's source pipeline and resolves @ tokens the
  way Codex's composer does: one whitespace-delimited token at the caret,
  with a quoted @" phrase for titles and paths with spaces.

  @scenario:input-trigger.quoted-multiword
  Scenario: The shared @ engine searches a quoted title phrase
    Given the isolated plugin profile "@dshfiles/mentions" is booted
    When threads named "deploy" and "fix the deploy script" are started
    And a new thread composer types "@\"fix the"
    Then a mention row includes the thread "fix the deploy script"

  @scenario:input-trigger.command-slash-entries
  Scenario: A command's / entry runs it from the composer
    Given the isolated plugin composition of "@dshfiles/input-trigger, @dshfiles/rich-composer, @dshfiles/session-controller, @dshfiles/shortcuts" is booted
    When "/side" is typed in the composer
    Then the slash menu offers the "Toggle sidebar" command
    When Enter picks the highlighted slash entry
    Then the sidebar collapses and the composer draft is empty

  @scenario:input-trigger.entity-registry
  Scenario: One shared card previews an agent mention and a backlog reference
    Given the isolated plugin composition of "@dshfiles/input-trigger, @dshfiles/agents, @dshfiles/backlog, @dshfiles/workspace-folder-picker, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    When the composer sends "Ask @dsh to look at b:1 next"
    And the agent mention "dsh" is previewed
    Then the shared reference card shows the "agent" card with "Open in Agents"
    When the backlog reference "b:1" is previewed
    Then the shared reference card shows the "backlog" card with "No backlog item b:1"
