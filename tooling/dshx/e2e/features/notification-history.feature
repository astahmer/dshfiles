Feature: Durable thread notification history

  Notification rows come from native Host turns, never an injected history writer.
  This isolated profile has no provider credentials, so real submitted turns fail.

  @scenario:thread-sidebar.notification-history
  Scenario: Retain thread events and manage their history across browser tabs
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/workspace-folder-picker" is booted
    When a real submitted turn produces a notification history entry
    Then notification history shows the source event at desktop and phone widths
    And notification read and dismiss actions are reversible and shared across tabs
    And opening a history entry returns to its existing thread
    And cancelling clear keeps history and confirming clear preserves newer arrivals
