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

  @scenario:queue-reorder.move-to-thread
  Scenario: Move queued messages with their attachments to a busy thread's queue and an idle thread's composer
    Given the isolated plugin composition of "@dshfiles/queue-reorder, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is kept busy by a held turn
    And "carry this" is queued with an image and a file, then "stay here" with an image
    And an idle thread "Idle target" and a busy thread "Busy target" exist
    And the thread "Fake thread title" is opened again
    When the queued message "carry this" is moved to "Busy target"
    Then the dock says it moved to the queue of "Busy target" and keeps only "stay here"
    When the queued message "stay here" is moved to "Idle target"
    Then "Idle target" opens with "stay here" and its image in the composer
    When the held turn finishes
    Then "Busy target" ran "carry this" with its image and file

  @scenario:queue-reorder.attachment-previews
  Scenario: Queued messages preview their images and files until the setting turns previews off
    Given the isolated plugin composition of "@dshfiles/queue-reorder, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is kept busy by a held turn
    And "carry this" is queued with an image and a file, then "stay here" with an image
    Then "carry this" shows a thumbnail of "red.png" and a chip for "note.txt"
    When queued attachment previews are turned off
    And the thread "Fake thread title" is opened again
    Then the queued messages show no attachment previews
