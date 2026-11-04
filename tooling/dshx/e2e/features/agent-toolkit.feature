Feature: Agent toolkit

  One page shows what the agent can use in a thread: tools by source, the
  loaded plugins with versions, MCP servers, skills and memory.

  @scenario:agent-toolkit.page
  Scenario: The page lists what the agent can use, and narrows by source and text
    Given the isolated plugin composition of "@dshfiles/agent-toolkit, @dshfiles/memory, @dshfiles/mcp-servers, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted with the autocomplete skill fixture
    When a thread "Toolkit thread" is started from the composer
    And the Agent toolkit is opened from the sidebar
    Then the Agent toolkit lists the registry tool, the plugin APIs, the plugins with versions, MCP servers, the skill and memory
    When the Agent toolkit shows only "Plugins" matching "agent-toolkit"
    Then only the agent toolkit plugin, its API and its own tool remain

  @scenario:agent-toolkit.palette
  Scenario: The command palette opens the page about the current thread
    Given the isolated plugin composition of "@dshfiles/agent-toolkit, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    When a thread "Toolkit thread" is started from the composer
    And the Agent toolkit is opened from the command palette
    Then the Agent toolkit is about the thread "Toolkit thread"

  @scenario:agent-toolkit.context-facet
  Scenario: The thread panel Context tab shows what the thread loads and its estimated cost
    Given the isolated plugin composition of "@dshfiles/agent-toolkit, @dshfiles/memory, @dshfiles/mcp-servers, @dshfiles/references, @dshfiles/agents, @dshfiles/workspace-folder-picker, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted with the autocomplete skill fixture
    When a thread "Context thread" is started from the composer
    And the Context tab is opened in the thread panel
    Then the Context tab lists the skill and the memory start block with token estimates
