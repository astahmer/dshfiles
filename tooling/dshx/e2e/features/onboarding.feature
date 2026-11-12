Feature: Onboarding

  Getting started shows a setup checklist read from the Host, the plugin packs
  and every catalogued feature, and opens only routes that exist. A three-step
  setup wizard (a non-modal card, a bottom sheet on a phone) opens while setup
  is missing, puts itself away for now on Escape, and ends by inserting a
  prompt it never sends.

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

  @scenario:onboarding.show-me-where
  Scenario: Show me where follows real clicks to a feature at 390 pixels and says where a feature that is not loaded lives
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/frame-layout, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    And Getting started is narrowed to 390 pixels wide
    And Show me where is started on "Browse and clean up memory in the Memory panel"
    Then the walk follows the phone steps, 4 of them, from "More"
    When Next is pressed from the keyboard on the walk
    And Next is pressed from the keyboard on the walk
    Then after 10 seconds the walk says the Memory button is not on screen and names Knowledge
    When the walk is ended with Escape
    Then no walk overlay or walk listener is left
    When Show me where is started on "DSH release notice and TL;DR"
    Then the walk rings "More" as step 1 of 3 without covering it, with 44 pixel controls
    When each ringed control is clicked in turn
    Then the walk reaches "Check for DSH updates", announces it, and clicked nothing by itself
    When the walk is ended
    Then no walk overlay or walk listener is left

  @scenario:onboarding.whats-new
  Scenario: What's new lists the checkout's changes, or says why it cannot, and marks them seen only when asked
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    Then What's new shows the checkout's changes or says why it cannot, and never errors
    When Getting started is narrowed to 390 pixels wide
    Then What's new keeps 44 pixel controls, and Mark as seen from the keyboard is the only thing that moves its last visit

  @scenario:onboarding.usage-suggestions
  Scenario: Suggestions stay off and read nothing until turned on in Settings, then suggest a feature or say honestly why not
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/usage, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    Then Suggestions is off and offers its setting in one line
    When Suggestions is turned on from its Settings link
    And Getting started is opened from the Knowledge destination
    Then Suggestions shows a suggestion or an honest empty state with 44 pixel controls at 390 pixels, and never errors

  @scenario:onboarding.try-it
  Scenario: Try it stays off and starts nothing, and once on its confirmation names the token cost and Cancel starts no thread
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    And Getting started is opened from the Knowledge destination
    Then no feature or pack offers Try it while it is off
    When Try it is turned on from its own feature row in Getting started
    And Getting started is opened from the Knowledge destination
    And Getting started is narrowed to 390 pixels wide
    And Try it is pressed from the keyboard on the "Try a feature with the agent in a new thread" feature
    Then the Try it confirmation names the token cost with 44 pixel controls and nothing was sent yet
    When the Try it confirmation is cancelled
    Then no thread was started and no model request was sent, and Try it has focus again

  @scenario:onboarding.reach-narrow
  Scenario: Curated features reach their final expect at 390 pixels on their phone steps
    Given the isolated plugin composition of "@dshfiles/onboarding, @dshfiles/frame-layout, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/settings-shell" is booted
    When the setup wizard shown on first run is skipped
    Then the phone walks of "settings-shell#settings-shell-port, settings-shell#dsh-release-notice, settings-shell#settings-task-groups, rich-composer#prompt-recall, thread-sidebar#section-order, thread-sidebar#thread-children-and-links" each reach their final expect at 390 pixels
