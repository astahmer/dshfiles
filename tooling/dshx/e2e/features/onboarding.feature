Feature: Onboarding

  Getting started shows a setup checklist read from the Host, the plugin packs
  and every catalogued feature, and opens only routes that exist. A three-step
  setup wizard shows while no thread is open, never blocks the app, and ends by
  inserting a prompt it never sends.

  @scenario:onboarding.getting-started
  Scenario: Getting started lists the checklist, packs and features and opens a registered page
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    Then Getting started shows the setup checklist, the packs and curated features
    And a feature whose page is not loaded has no Open button
    When Getting started is narrowed to 390 pixels wide
    Then every Getting started control is at least 44 pixels tall and the search answers to the keyboard
    When a feature's Open button is used
    Then that feature's page replaces Getting started

  @scenario:onboarding.wizard-journey
  Scenario: The setup wizard replays from the palette and inserts a prompt without sending it
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    Then the setup wizard stays closed after a reload
    When the setup wizard is replayed from the command palette
    And the setup wizard is walked to the first task and a starter prompt is inserted
    Then the composer holds the starter prompt and no message was sent
    When Getting started is opened from the command palette
    Then the palette opened Getting started with its eight packs

  @scenario:onboarding.pack-preview
  Scenario: Enable pack previews exactly what would change at 390 pixels, and Cancel changes nothing and restarts nothing
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    And Getting started is narrowed to 390 pixels wide
    And Enable pack is pressed from the keyboard on the "Observe & perf" pack
    Then the pack preview names what would install and the restart it needs, with 44 pixel controls and no page shift
    When the pack preview is dismissed with Escape
    Then the "Observe & perf" pack is unchanged, its Enable pack button has focus again and nothing was applied or restarted
