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
    And the agent "Reviewer" may only message "dsh"
    And the Agents panel lists "Reviewer" with those instructions

  @scenario:agents.thread-history
  Scenario: An agent keeps the threads it started
    Given the isolated plugin profile "@dshfiles/agents" is booted
    Then the agent "Reviewer" is saved with instructions "Prefer small findings."
    When a thread is started from the agent "reviewer" with "Review the open pull requests"
    And the browser page is reloaded with the Agents panel open
    Then the agent "reviewer" lists "Review the open pull requests" and counts 1 thread

  @scenario:agents.comment-autocomplete
  Scenario: Complete an agent handle inside an item's comment box
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/agents, @dshfiles/ai-accounts" is booted
    When the Backlog panel is opened
    And "Complete the reviewer" is captured
    When backlog item b:1 is opened
    And "@ds" is typed in the open item comment box
    Then the agent suggestion "@dsh" is offered
    When the agent suggestion "@dsh" is picked
    Then the comment box reads "@dsh "
    When "@b:1" is typed in the open item comment box
    Then no agent suggestion is offered
