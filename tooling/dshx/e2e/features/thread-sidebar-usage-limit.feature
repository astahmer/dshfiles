Feature: Thread sidebar quota recovery

  @scenario:thread-sidebar.usage-limit-group
  Scenario: A quota-blocked thread appears under Usage limit
    Given the isolated ThreadSidebar and AI Accounts plugin profile is booted
    When an exhausted Command Code account fails a turn with failover off
    Then the blocked session appears in the Usage limit group
