Feature: Sidebar settings belong to the Threads panel

  @scenario:thread-sidebar.panel-settings-wheel
  Scenario: One settings gear and the original editor stay with the Threads panel
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    Then the sidebar settings gear belongs to the Threads panel instead of fixed chrome
    When the panel gear changes and saves the Search threads visibility preference
    Then that same sidebar preference survives reload and can be restored through the gear
    When the Threads panel is moved right and its tab row is hidden
    Then its settings editor stays inside that panel even with the left sidebar collapsed
