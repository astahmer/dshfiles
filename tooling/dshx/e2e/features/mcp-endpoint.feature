Feature: Outside agents drive threads through the MCP endpoint

  Settings issue a bearer token once with a copyable Claude Code command; an MCP
  client outside the browser then lists, starts and reads threads over
  streamable HTTP at /mcp. The loopback Command Code fake answers the turn.

  @scenario:mcp-endpoint.settings-token
  Scenario: Settings issue the token once with a Claude Code command
    Given the isolated plugin composition of "@dshfiles/mcp-endpoint, @dshfiles/session-controller" is booted
    Then the MCP endpoint refuses a client without a token
    When a token is generated in the MCP endpoint settings with a Claude Code command
    Then reopened MCP endpoint settings no longer show the token

  @scenario:mcp-endpoint.outside-agent
  Scenario: An MCP client with the token starts a thread and reads its answer
    Given the isolated plugin composition of "@dshfiles/mcp-endpoint, @dshfiles/session-controller, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a token is generated in the MCP endpoint settings with a Claude Code command
    And an MCP client with that token starts a thread with a first prompt
    Then the MCP client lists the thread and reads the answer to its prompt
    And the thread opens on that answer in the app
