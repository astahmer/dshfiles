Feature: Thread sidebar quota recovery

  @scenario:thread-sidebar.usage-limit-group
  Scenario: A quota-blocked thread appears under Usage limit
    Given the isolated ThreadSidebar and AI Accounts plugin profile is booted
    When an exhausted Command Code account fails a turn with failover off
    Then the blocked session appears in the Usage limit group
    And the blocked session is listed only in the Usage limit group when grouped by date

  @scenario:thread-sidebar.row-verb-clear-of-hover-actions
  Scenario: A row's inline verb stays clickable while its hover actions show
    Given the isolated ThreadSidebar and AI Accounts plugin profile is booted
    When an exhausted Command Code account fails a turn with failover off
    Then the blocked row keeps its Resume verb clear of the hover actions
