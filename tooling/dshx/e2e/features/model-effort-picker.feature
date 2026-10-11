Feature: Model effort picker

  These journeys use a fresh isolated Host profile with no provider credentials.

  @scenario:model-effort-picker.search-empty-catalog
  Scenario: Search for a missing model before changing reasoning effort
    Given the isolated plugin profile "@dshfiles/model-effort-picker" is booted
    When the composer model picker is searched for an unavailable model
    Then the picker shows an empty result and asks for a model before reasoning can change
