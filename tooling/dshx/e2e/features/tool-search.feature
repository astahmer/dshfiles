Feature: Tool Search

  Tool Search exposes agent-scoped discovery, so its journey boots the real
  isolated plugin profile and exercises the Host and AgentLoop on a fresh
  scratch DSH. No live profile, external provider, or user workspace is used.

  @scenario:tool-search.scratch-agent-loop
  Scenario: Search and disclose tools through the AgentLoop
    Given the isolated plugin profile "@dshfiles/tool-search" is booted
    When the Tool Search scratch Host journey is run
    Then progressive discovery passes its real AgentLoop acceptance journey
