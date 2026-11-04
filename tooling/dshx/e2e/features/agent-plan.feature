Feature: Agent plan, live activity and failure cards

  todo_write calls read as a plan with step N of M and the current step is
  pinned by the composer; what runs now shows beside the composer controls;
  a failed turn offers Retry and Ask to fix through the composer.

  @scenario:agent-plan.plan-card
  Scenario: Successive todo_write calls show the plan, its progress and the pinned step
    Given the isolated plugin composition of "@dshfiles/agent-plan, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes a three-step plan and then marks its first step done in a fresh workspace
    Then the latest plan card says step 2 of 3 and lists every step

  @scenario:agent-plan.pinned-step
  Scenario: The current plan step is pinned beside the composer and opens the plan
    Given the isolated plugin composition of "@dshfiles/agent-plan, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes a three-step plan and then marks its first step done in a fresh workspace
    Then the composer pins the current plan step

  @scenario:agent-plan.activity-strip
  Scenario: A tool call that is still running shows in the activity strip
    Given the isolated plugin composition of "@dshfiles/agent-plan, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model starts a twenty-second command in a fresh workspace
    Then the activity strip names the running tool call with a timer

  @scenario:agent-plan.failure-card
  Scenario: A failed turn offers Ask to fix through the composer
    Given the isolated plugin composition of "@dshfiles/agent-plan, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/rich-composer, @dshfiles/session-controller" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake provider rejects the next request in a fresh workspace
    Then the failed turn offers Retry and Ask to fix
    And Ask to fix puts the failure into the composer
