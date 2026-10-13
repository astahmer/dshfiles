Feature: Queued message dock

  A held turn on the fake Command Code account keeps the thread busy, so
  messages sent meanwhile queue in the dock above the composer.

  @scenario:queue-reorder.move-message
  @scenario:queue-reorder.drag-target
  @scenario:queue-reorder.message-preview
  Scenario: Reorder queued messages with buttons and drag, then run them in that order
    Given the isolated plugin composition of "@dshfiles/queue-reorder, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is kept busy by a held turn
    And the messages "first queued", "second queued" and a long third one are queued
    Then the queue reads "first queued", "second queued", "third queued"
    And the edges of the queue cannot move further
    And the long message previews as one truncated line
    When the first queued message is moved down
    Then the queue reads "second queued", "first queued", "third queued"
    When the third queued message is dragged onto the first
    Then the queue reads "third queued", "second queued", "first queued"
    When the held turn finishes
    Then the provider receives the queued messages in the reordered order

  @scenario:queue-reorder.busy-locks
  Scenario: Edit a queued message in the composer and cancel it back into place
    Given the isolated plugin composition of "@dshfiles/queue-reorder, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is kept busy by a held turn
    And the messages "first queued", "second queued" and a long third one are queued
    And the second queued message is edited in the composer
    Then the composer holds its text while the queue locks and Escape puts it back

  @scenario:queue-reorder.dock-preferences
  Scenario: Dock preferences collapse the queue and shorten previews
    Given the isolated plugin composition of "@dshfiles/queue-reorder, @dshfiles/ai-accounts" is booted
    When queued messages are set to start collapsed with 40-character previews
    And a Command Code account backed by a local fake provider is added
    And a thread on the fake model is kept busy by a held turn
    And the messages "first queued", "second queued" and a long third one are queued
    Then the queue starts collapsed and previews at most 40 characters
