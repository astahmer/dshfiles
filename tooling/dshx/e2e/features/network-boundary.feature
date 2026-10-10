Feature: Browser E2E network boundary

  Browser requests to non-local origins must be stopped before external services are contacted.

  Scenario: Reject a fetch to a reserved external origin
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the browser fetches a reserved external URL
    Then the E2E browser network boundary rejects that fetch
