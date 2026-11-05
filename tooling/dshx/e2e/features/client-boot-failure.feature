Feature: Client boot failure reporting

  A client entry that throws while activating must be named on the boot card by
  its entry id, so a broken bundle is reported instead of hiding behind a
  generic failure. The fixture bundle lives in e2e/fixtures/failing-client and
  never joins a real profile.

  Scenario: A client entry whose apply throws is reported by its id
    Given a scratch profile with a client entry that throws in apply is booted
    Then the client entry "@dshfiles-e2e/failing-client" is reported as failed by its id
    And every client entry that failed to activate is reported by id
