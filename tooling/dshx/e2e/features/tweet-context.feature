Feature: Tweet context

  A public X post's text and sampled video frames are available to the agent.

  @scenario:tweet-context.tool-catalog
  @smoke
  Scenario: The Agent toolkit exposes the tweet context tool
    Given the isolated plugin composition of "@dshfiles/agent-toolkit, @dshfiles/memory, @dshfiles/mcp-servers, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/tweet-context" is booted
    When a thread "Tweet context thread" is started from the composer
    And the Agent toolkit is opened from the sidebar
    And the Agent toolkit shows only "Plugins" matching "tweet_context"
    Then the Agent toolkit shows the third-party source and frame behavior
