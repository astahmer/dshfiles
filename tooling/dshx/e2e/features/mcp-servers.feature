Feature: MCP servers

  A tiny stdio MCP server in the e2e support tree stands in for a real one,
  so the native client really loads it and registers its tool.

  @scenario:mcp-servers.server-validation
  Scenario: Unsafe HTTP endpoints are never saved
    Given the isolated plugin profile "@dshfiles/mcp-servers" is booted
    When the MCP servers page is opened
    Then plain-HTTP and credential-bearing endpoints are refused on submit

  @scenario:mcp-servers.lifecycle
  Scenario: Add, disconnect, reconnect, disable and remove a stdio server
    Given the isolated plugin profile "@dshfiles/mcp-servers" is booted
    When the MCP servers page is opened
    And the local echo MCP server is added as a stdio command
    Then the Echo server reads "Native client loaded · 1 Host tools registered"
    And it never claims a remote health ping
    When the Echo server is "Disconnect"
    Then the Echo server reads "Stopped by user"
    When the Echo server is "Connect"
    Then the Echo server reads "Native client loaded"
    When the Echo server is "Disable"
    Then the Echo server reads "Disabled in configuration"
    And removing the Echo server after confirmation empties the list
