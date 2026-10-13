Feature: OptMem memory journeys

  Real turns run against a loopback stand-in for Command Code added through
  AI Accounts, so captured events, injected memory and memory tools are read
  back from the requests the provider receives and from the OptMem Explorer.

  @scenario:optmem.capture-dedup
  @scenario:optmem.exclusions
  Scenario: Capture each event once and keep excluded files out of memory
    Given the isolated plugin composition of "@dshfiles/optmem, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable workspace "capture-project" holding a secret .env file is added
    And a Command Code account backed by a local fake provider is added
    And a thread in the workspace "capture-project" uses the fake Command Code model
    And "optmem capture kiwi-731 then [[read .env]]" is sent to the fake model
    And "optmem follow-up mango-731" is sent to the fake model
    Then OptMem search finds "kiwi-731" exactly once
    And memory keeps only an exclusion marker for the .env read

  @scenario:optmem.full-fallback
  Scenario: Full mode stays unavailable without the request-messages bundle
    Given the isolated plugin profile "@dshfiles/optmem" is booted
    When the OptMem Memory settings section is opened
    Then full mode is offered only with request-messages and the status reports compatibility

  @scenario:optmem.injection-bounds
  Scenario: Full mode replaces earlier turns with a bounded memory view
    Given the isolated plugin composition of "@dshfiles/optmem, @dshfiles/request-messages, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When OptMem is switched to full mode with a 1024-byte injected view
    And a disposable workspace "injection-project" holding a secret .env file is added
    And a Command Code account backed by a local fake provider is added
    And a thread in the workspace "injection-project" uses the fake Command Code model
    And "remember the release codename papaya-731" is sent to the fake model
    And "what was the release codename?" is sent to the fake model
    Then the next turn carries "papaya-731" only through the bounded memory view

  @scenario:optmem.summarizer-failure
  Scenario: A failing summarizer leaves events pending and searchable
    Given the isolated plugin composition of "@dshfiles/optmem, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable workspace "summary-project" holding a secret .env file is added
    And a Command Code account backed by a local fake provider is added
    And OptMem summaries "fail"
    And a thread in the workspace "summary-project" uses the fake Command Code model
    And "guava-731 oversized note: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum and then some more padding text to cross the node budget" is sent to the fake model
    Then the OptMem status reports a pending summary and the summarizer error
    And the raw message "guava-731" is still searchable while its summary is pending

  @scenario:optmem.barrier-cancel
  Scenario: Stopping a turn during the summary barrier sends nothing stale
    Given the isolated plugin composition of "@dshfiles/optmem, @dshfiles/request-messages, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When OptMem is switched to full mode with a 8192-byte injected view
    And a disposable workspace "barrier-project" holding a secret .env file is added
    And a Command Code account backed by a local fake provider is added
    And OptMem summaries "hang"
    And a thread in the workspace "barrier-project" uses the fake Command Code model
    And "lychee-731 oversized note: lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua ut enim ad minim veniam quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur excepteur sint occaecat cupidatat non proident sunt in culpa qui officia deserunt mollit anim id est laborum and then some more padding text to cross the node budget" is sent to the fake model
    And "a second turn that must wait for the pending summary" is sent and stopped while OptMem waits for pending summaries
    Then the stopped turn never reached the provider

  @scenario:optmem.recall-scope
  Scenario: Memory search stays inside the calling project unless cross-project reads are enabled
    Given the isolated plugin composition of "@dshfiles/optmem, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable workspace "alpha-project" holding a secret .env file is added
    And a disposable workspace "beta-project" holding a secret .env file is added
    And a Command Code account backed by a local fake provider is added
    And a thread in the workspace "alpha-project" uses the fake Command Code model
    And "alpha fact quince-731" is sent to the fake model
    And a thread in the workspace "beta-project" uses the fake Command Code model
    And "[[memory_search quince-731]]" is sent to the fake model
    Then the memory search tool result "omits" "alpha fact"
    When "[[memory_search quince-731 in all-projects]]" is sent to the fake model
    Then the memory search tool result "omits" "alpha fact"
    When cross-project memory tools are enabled
    And "[[memory_search quince-731 in all-projects]]" is sent to the fake model
    Then the memory search tool result "contains" "alpha fact"

  @scenario:optmem.database-failure
  Scenario: An unreadable memory database is reported without stalling the Host
    Given the isolated plugin profile "@dshfiles/optmem" is booted
    When the OptMem database is replaced by a corrupt file while OptMem is off
    Then OptMem reports the database failure and the Host stays responsive
