Feature: Resume the latest interrupted task inline

  @scenario:chat.resume-interrupted
  Scenario: Only the latest idle interrupted task can be resumed
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/session-controller" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread with two interrupted tasks is opened
    Then only the latest stopped notice offers Resume
    When the latest stopped task is resumed inline
    Then the stopped notices remain but Resume disappears

  @scenario:chat.image-links
  Scenario: A local image link opens in the gallery, not a side panel
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a chat thread with a local image link is opened
    Then the image link opens in the gallery rather than a side panel
