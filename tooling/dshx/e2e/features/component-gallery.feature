Feature: Component gallery

  Every shared plugin-ui component renders live on one page, one tab per
  category, so a plugin author can see and copy it before importing it.

  @scenario:component-gallery.browse
  Scenario: Browse, filter and replay shared components
    Given the isolated plugin profile "@dshfiles/component-gallery" is booted
    When the component gallery is opened
    Then the gallery shows the "Agents" category with its components
    When the gallery switches to the "Kit" category
    And the gallery is filtered by "switch"
    Then only the "Inputs and toggles" component is listed
    When the gallery is filtered by "no-such-component"
    Then the gallery says nothing matches and how to recover
