Feature: Model effort picker

  These journeys use a fresh isolated Host profile with no provider credentials.

  @scenario:model-effort-picker.search-empty-catalog
  Scenario: Search preserves the selected model when the catalog is empty
    Given the isolated plugin profile "@dshfiles/model-effort-picker" is booted
    Then the Web UI mounts without a plugin failure card
    When a submitted prompt opens a scratch Session
    Then no Slot fell back to its error boundary
    When the composer model picker is searched for an unavailable model
    Then the empty catalog preserves selection without model-specific reasoning controls
