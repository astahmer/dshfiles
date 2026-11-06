Feature: Conversation cleanup

  Cleanup is an optional plugin. This journey uses only synthetic, cold native
  JSONL conversations in a disposable home, never the active user's profile.

  @scenario:conversation-cleanup.confirmed-deletion
  Scenario: Preview and cancel preserve archived logs until deletion is confirmed
    Given the isolated conversation-cleanup profile has two cold archived conversations
    When the conversation cleanup settings are opened
    And the conversation cleanup preview is requested
    Then both archived conversations appear in the cleanup preview
    When conversation cleanup deletion is cancelled
    Then both conversation logs remain unchanged on disk
    When conversation cleanup deletion is confirmed
    Then both conversation log generations are deleted from disk
    When the conversation cleanup preview is requested
    Then the cleanup preview is empty and deletion is disabled
