Feature: Background jobs board

  The Jobs board reads the job registry for live work and the session logs for
  everything already recorded. A seeded sessions root gives it five recorded
  jobs across four categories, one of them never settled.

  @scenario:background-jobs.board-browser-journey
  Scenario: Browse, classify and filter every Session's background jobs
    Given the isolated plugin profile "@dshfiles/background-jobs" is booted
    When recorded background jobs are seeded into the sessions root
    And the Jobs panel is opened
    Then the board lists the recorded jobs with their categories and statuses
    And the category filter, the scope and the search narrow the board

  @scenario:background-jobs.oversized-live-label
  Scenario: A live job whose label exceeds the wire bound still renders
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread starts a running bash job whose label exceeds the wire bound
    Then the board shows that job with its label clamped to the bound
