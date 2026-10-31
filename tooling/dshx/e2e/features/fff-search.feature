Feature: fff-search agent tools

  The fake Command Code model asks the running Agent to call its real grep and
  glob tools against one fixture in a fresh workspace.

  @scenario:fff-search.agent-grep-glob
  Scenario: Agent grep and glob return the indexed workspace fixture
    Given the isolated plugin composition of "@dshfiles/fff-search, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model calls resident grep and glob on the workspace
    Then the real grep and glob tool results contain the fixture
