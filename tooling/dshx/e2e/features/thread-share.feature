Feature: Share a thread as a read-only link

  Settings › Thread sharing creates a link for one thread; a browser without the
  DSH cookie opens it on the plugin's own route and sees only that thread's
  messages. Revoking the share in the settings turns the link off at once. The
  loopback Command Code fake answers the turn; nothing leaves loopback.

  @scenario:thread-share.share-link
  Scenario: A share link shows only the shared thread and stops working once revoked
    Given the isolated plugin composition of "@dshfiles/thread-share, @dshfiles/session-controller, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model writes "[[answer Answered for the share link]]"
    And a live share link for that thread is created in the Thread sharing settings
    Then a client without the DSH cookie reads only that thread on the share link
    When the share is revoked in the Thread sharing settings
    Then the share link no longer opens
