Feature: Capabilities hub

  One page names the three kinds of capability (skills, MCP servers, DSH
  plugins), how far each can reach, and opens each owner's own manager. It
  links out to skills.sh instead of searching or installing in place.

  @scenario:capabilities-hub.launchpad
  Scenario: The hub labels each kind's trust, counts it, and opens its manager
    Given the isolated plugin composition of "@dshfiles/capabilities-hub, @dshfiles/mcp-servers, @dshfiles/agent-toolkit" is booted
    When the Capabilities hub is opened from the sidebar
    Then the Capabilities hub shows skills, MCP servers and DSH plugins with separate trust labels
    And the Capabilities hub links out to skills.sh with a telemetry-off command
    When the MCP servers manager is opened from the Capabilities hub
    Then the MCP servers manager owns the page
