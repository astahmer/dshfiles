Feature: Browser E2E network boundary

  Browser requests to non-local origins must be stopped before external services are contacted.

  Scenario: Reject fetches to external and unapproved loopback origins
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the browser fetches unapproved external and loopback origins
    Then the E2E browser network boundary rejects both fetches
