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

  @scenario:background-jobs.batch-stop
  Scenario: Stop several running jobs through one confirmation
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread starts two running bash jobs
    And the Jobs panel lists both batch jobs in the Running scope
    Then selecting both jobs and stopping them through confirmation clears the Running scope

  @scenario:background-jobs.oversized-live-label
  Scenario: A live job whose label exceeds the wire bound still renders
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread starts a running bash job whose label exceeds the wire bound
    Then the board shows that job with its label clamped to the bound

  @scenario:background-jobs.processes-page
  Scenario: Jobs and RAM are tabs of one Processes page
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/worktree-memory" is booted
    When the Processes page is opened
    Then its RAM tab shows the process memory that was its own page

  @scenario:background-jobs.thread-jobs-facet
  Scenario: A thread's Jobs facet lists the job that thread runs
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread starts two running bash jobs
    Then the thread's Jobs facet lists only that thread's running job

  @scenario:background-jobs.transcript-job-preview
  Scenario: A running job stays previewed above the composer after its turn ends
    Given the isolated plugin composition of "@dshfiles/background-jobs, @dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread starts a background job that keeps writing output
    Then the composer dock previews the running job and streams its output
    And stopping the job from the preview takes a confirmation
