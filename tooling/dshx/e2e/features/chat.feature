Feature: Chat browser journeys

  @scenario:chat.windowed-transcript
  Scenario: A long persisted transcript mounts older rows as the reader scrolls
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a real thread with one hundred eighty transcript turns is opened
    Then the latest transcript rows are visible and older rows appear when scrolling up

  @scenario:chat.windowed-transcript-steady-scroll
  Scenario: Scrolling up a long transcript never jumps while older rows mount
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a real thread with one hundred eighty transcript turns is opened
    Then each upward wheel step moves the rows under the reader by the wheel distance

  @scenario:session-controller.lean-session-follow
  Scenario: A real Host follow renders history without provider replay blocks in browser frames
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a real Host session with provider replay data is opened
    Then the browser renders the response without receiving provider replay blocks


  @scenario:chat.resume-interrupted
  Scenario: Only the latest idle interrupted task can be resumed
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/session-controller" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread with two interrupted tasks is opened
    Then only the latest stopped notice offers Resume
    When the latest stopped task is resumed inline
    Then the stopped notices remain but Resume disappears

  @scenario:chat.retry-failed-turn
  Scenario: A turn that failed before any reply is retried without a continue prompt
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/session-controller" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread whose first request failed is opened
    Then the failed turn offers Retry instead of Resume
    When the failed turn is retried inline
    Then the request runs again without a continue prompt

  @scenario:chat.image-links
  Scenario: A local image link opens in the gallery, not a side panel
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a chat thread with a local image link is opened
    Then the image link opens in the gallery rather than a side panel

    @scenario:chat.read-image-gallery
  Scenario: A read image tool summary opens a navigable turn gallery
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When a read image tool summary path is opened
    Then the read image tool path opens in a navigable gallery rather than a side panel

  @scenario:chat.image-gallery-thread-scope
  Scenario: The thread gallery includes images from other turns
    Given the isolated plugin composition of "@dshfiles/chat, @dshfiles/session-controller" is booted
    When thread gallery scope is selected and a read image path is opened
    Then the thread gallery includes images from other turns


