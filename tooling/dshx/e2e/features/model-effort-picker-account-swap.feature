Feature: Model effort picker account swap

  @scenario:model-effort-picker.account-swap
  Scenario: Swap accounts without changing the selected model or reasoning effort
    Given the isolated AI Accounts and model effort picker plugin profile is booted
    When two Command Code accounts offer the same model in a new thread
    Then swapping accounts keeps the model and selects the next account
