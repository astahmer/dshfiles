Feature: Empty fixed conversation welcome

  @scenario:workbench.empty-thread-welcome
  Scenario: An empty fixed thread keeps the native centered welcome until its first message
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When a real empty fixed conversation and an existing chat are opened
    Then the empty thread shows the native centered welcome and one scoped composer
    And its welcome draft survives switching reload and a narrow split pane
    When its first real message is sent from the welcome composer
    Then the same editor becomes a normal fixed conversation without the welcome
