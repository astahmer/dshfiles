Feature: Workbench window scope

  A conversation's owning project is not an instruction to replace the current
  Workbench scene. This recovery fixture uses two real registered projects and
  the versioned persisted legacy layouts seen before the scope policy changed.

  @scenario:workbench.cross-project-chooser
  @scenario:main-tabs.cross-project-chooser
  Scenario: Selecting existing conversations from different projects preserves the ordinary New tab
    Given an isolated two-project Workbench scope profile is booted
    And two real projects have conversations in a legacy mixed Workbench scene
    When the already-open other-project conversation is selected
    Then the same chooser order pins and conversation drafts survive project-crossing switches and reload
