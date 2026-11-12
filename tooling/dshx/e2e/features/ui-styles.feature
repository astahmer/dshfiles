Feature: One shared plugin stylesheet

  The union Tailwind sheet is compiled once, by @dshfiles/ui-styles. Every other
  plugin ships no stylesheet of its own, so an isolated plugin boot must compose
  the owner or the plugin mounts with no utilities at all.

  @scenario:ui-styles.isolated-boot-sheet
  Scenario: An isolated plugin boot injects the shared stylesheet
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    Then exactly one shared plugin stylesheet is injected

  @scenario:ui-styles.appearance-preset
  Scenario: An Appearance preset repaints plugin and native surfaces, survives a reload and resets to the static default
    Given the isolated plugin composition of "@dshfiles/ui-styles, @dshfiles/settings-shell" is booted
    When the Appearance preset "Slate blue" is chosen in Settings
    Then the page and a native Host surface follow the hue 250
    When the Web UI is reloaded with the theme saved
    Then the theme with the hue 250 is still applied
    When the Appearance preset "Warm stone" is chosen in Settings
    Then the static default theme is the whole theme

  @scenario:ui-styles.theme-agent-tools
  Scenario: The agent reads, changes and resets the theme with theme_get and theme_set
    Given the isolated plugin composition of "@dshfiles/ui-styles,@dshfiles/ai-accounts,@dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And a new thread on the fake model calls theme_set with the preset "moss"
    Then theme_set answered with the preset "moss" and the hue 135
    And the page and a native Host surface follow the hue 135
    When the thread calls theme_get
    Then theme_get reports the preset "moss"
    When the thread calls theme_set with reset
    Then theme_set answered with the default theme
    And the static default theme is the whole theme

  @scenario:ui-styles.touch-baseline
  Scenario: The touch baseline leaves dshx utilities in charge of touch-action
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat" is booted
    Then a dshx touch-none control keeps touch-action none and a plain button keeps touch-action manipulation
