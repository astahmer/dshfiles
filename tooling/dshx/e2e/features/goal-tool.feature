Feature: Goal tool replacement

  The owned Host fork replaces the native goal-tool Loader row. Its lifecycle
  keeps the ordinary bounded goal behavior while the authority regression is
  exercised by the focused unit tests.

  @scenario:goal-tool.replacement-goal-lifecycle
  Scenario: The owned native goal-tool replacement works with bounded goal continuation
    Given the isolated plugin composition of "@dshfiles/goal-tool,@dshfiles/goal-stall-guard,@dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a one-round goal is started with a one-shot extension request
    Then the extension is applied and the goal blocks at its new limit
    When completion evidence is delivered to the round-limited goal
    Then the round-limited goal is marked complete
