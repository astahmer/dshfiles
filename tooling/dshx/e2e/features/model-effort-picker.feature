Feature: Model effort picker

  These journeys use a fresh isolated Host profile with no provider credentials.

  @scenario:model-effort-picker.search-empty-catalog
  Scenario: Search preserves the model while the slider updates reasoning
    Given the isolated plugin profile "@dshfiles/model-effort-picker" is booted
    Then the Web UI mounts without a plugin failure card
    When a submitted prompt opens a scratch Session
    Then no Slot fell back to its error boundary
    When the composer model picker is searched for an unavailable model
    Then an empty search preserves the selected model and reasoning controls
    When the reasoning-effort slider is adjusted one step
    Then the picker reflects the adjusted reasoning effort
