@agents
Feature: Persistent agents
  An agent is saved configuration — handle, instructions, model route and tool preset — that starts an
  ordinary thread when it is mentioned where a thread starts.

  @scenario:agents.comment-dispatch
  Scenario: Mention an agent in a backlog comment and start its thread
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/agents, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And the Backlog panel is opened
    And "Mention the reviewer" is captured
    When backlog item b:1 is opened
    And "@dsh look at b:1" is commented on the open item
    Then the agent thread "Mention the reviewer" opens with its instructions for "look at b:1"
    When the Backlog panel is opened
    And backlog item b:1 is opened
    Then the item links the @dsh thread "Mention the reviewer"
    And the start thread dialog offers the agent "@dsh"

  @scenario:agents.create-agent
  Scenario: Create an agent and keep its instructions
    Given the isolated plugin profile "@dshfiles/agents" is booted
    Then the agent "Reviewer" is saved with instructions "Prefer small findings."
    And the Agents panel lists "Reviewer" with those instructions
