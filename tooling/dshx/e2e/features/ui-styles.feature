Feature: One shared plugin stylesheet

  The union Tailwind sheet is compiled once, by @dshfiles/ui-styles. Every other
  plugin ships no stylesheet of its own, so an isolated plugin boot must compose
  the owner or the plugin mounts with no utilities at all.

  @scenario:ui-styles.isolated-boot-sheet
  Scenario: An isolated plugin boot injects the shared stylesheet
    Given the isolated plugin profile "@dshfiles/thread-sidebar" is booted
    Then exactly one shared plugin stylesheet is injected
