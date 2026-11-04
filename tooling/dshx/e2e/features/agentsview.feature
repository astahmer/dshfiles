Feature: Agent CLI sessions browser

  Agent CLI threads reads the session logs other agent CLIs keep under HOME. The
  scratch Host's HOME is its isolated home, so seeding one Claude Code log and
  one Codex rollout there gives the page exactly two sessions to list, search
  and read, without touching the real ~/.claude or ~/.codex.

  @scenario:agentsview.browser-journey
  Scenario: List, search and read Claude Code and Codex sessions
    Given the isolated plugin profile "@dshfiles/agentsview" is booted
    When Claude Code and Codex session logs are seeded into the scratch HOME
    And the Agent CLI threads page is opened and refreshed
    Then it lists both seeded sessions with their agent and working directory
    And the agent filter narrows the list to Codex
    And a message search finds the Claude Code reply and opens it in its transcript
