Feature: GitHub Copilot subscription accounts

  @scenario:ai-accounts.github-copilot
  Scenario: Add a GitHub Copilot subscription account
    Given the isolated plugin profile "@dshfiles/ai-accounts" is booted
    When a GitHub Copilot account is added
    Then it offers GitHub device-code sign-in
