Feature: OpenCode plugin tools

  @scenario:opencode-compat.plugin-tool
  Scenario: A configured OpenCode plugin adds and guards a tool
    Given the isolated plugin composition of "@dshfiles/opencode-compat,@dshfiles/ai-accounts,@dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And the OpenCode sample plugin is saved in Settings
    And a new thread on the fake model calls the OpenCode sample tool with "hello"
    Then the OpenCode sample tool returns "hello (via opencode-sample)"
    When the thread calls the OpenCode sample tool with "blocked"
    Then the OpenCode sample tool returns "Denied by opencode-sample"
