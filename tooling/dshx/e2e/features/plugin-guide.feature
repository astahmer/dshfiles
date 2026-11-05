Feature: Plugin guide

  A developer page over a static, build-time catalog of DSH extension
  surfaces: what each one adds or replaces, where it is declared, and a
  draft-only hand-off to an agent.

  @scenario:plugin-guide.browse
  Scenario: The guide marks the shell slot high risk and drafts guidance without sending it
    Given the isolated plugin composition of "@dshfiles/plugin-guide" is booted
    When the Plugin guide is opened from the sidebar
    Then the Plugin guide names its static catalog version and never claims live occupancy
    When the Plugin guide shows the "sidebar" native slot
    Then the slot is marked shell-owned and high risk
    When the guidance is drafted for an agent
    Then a new thread holds the guidance in its composer, unsent
