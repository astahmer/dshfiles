Feature: Browser E2E network boundary

  Browser HTTP and WebSocket requests may reach only the isolated scratch profile origin.

  Scenario: Reject unapproved external and loopback HTTP and WebSocket requests
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When the browser tries unapproved HTTP and WebSocket origins
    Then the E2E browser network boundary rejects both transports
