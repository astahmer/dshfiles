Feature: Usage analytics

  The Usage analytics panel indexes the session logs under the scratch home:
  recorded logs trimmed from real sessions, plus the thread a scenario runs,
  whose turn fails for want of provider credentials. A seeded models.dev
  price cache stands in for the one AI Accounts downloads.

  Background:
    Given the isolated plugin profile "@dshfiles/usage" is booted
    When a thread runs a turn that fails for want of credentials
    And recorded session logs and a price catalog are seeded
    And the Usage analytics panel is opened on the range since "2026-10-01"

  @scenario:usage.request-log-browser-journey @scenario:usage.index-browser-journey
  Scenario: Read, filter and follow the request log
    Then the request log lists requests with tokens, list-price costs, timings and status
    And the status chips, the search and the purpose filter narrow the log
    And a failed request opens the thread that made it

  @scenario:usage.charts-browser-journey @scenario:usage.jev-usage-card-browser-journey
  Scenario: Read the usage charts
    When the Charts tab is opened
    Then the headline tiles, the charts and the top threads show the indexed usage
    And the Jev usage card shows DSH-local token estimates
    And selecting a model in the cost breakdown shows its requests in the log

  @scenario:usage.activity-report-browser-journey
  Scenario: Read tool and Jev activity
    When the Tools & Jev tab is opened
    Then the tool execution report and Jev call report are visible
