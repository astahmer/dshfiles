Feature: Prompt stash

  These journeys use a fresh isolated browser profile and the real composer UI.
  They do not submit a message or call a live model/provider API.

  @scenario:prompt-stash.prompt-library-management
  Scenario: Search, edit, and delete saved prompts
    Given the isolated plugin profile "@dshfiles/prompt-stash" is booted
    When the prompt library is opened
    And a saved prompt "Release checklist" with text "Summarize the release risks." is created
    And a saved prompt "Support reply" with text "Acknowledge the support request." is created
    When the saved prompts are searched for "Release"
    Then only the saved prompt "Release checklist" is listed
    When the saved prompt "Release checklist" is edited to "Release checklist v2" with text "Summarize release risks and mitigations."
    Then the saved prompt "Release checklist v2" is listed with text "Summarize release risks and mitigations."
    When deletion of the saved prompt "Support reply" is canceled
    Then the saved prompt "Support reply" remains listed
    When the saved prompt "Support reply" is deleted
    Then the saved prompt "Support reply" is no longer listed

  @scenario:prompt-stash.library-conflict
  Scenario: Keep local edits when another tab changes a saved prompt
    Given the isolated plugin profile "@dshfiles/prompt-stash" is booted
    When the prompt library is opened
    And a saved prompt "Original prompt" with text "Original text." is created
    And the saved prompt "Original prompt" is opened for editing
    And the prompt editor is changed to title "Local draft" and text "Local edits stay in this editor."
    When the saved prompt "Original prompt" is changed in another tab to title "Updated elsewhere" and text "The other tab saved this version."
    Then the local editor is marked stale and keeps its edits
    When the local edits are saved as a separate copy
    Then both the updated prompt and local copy remain listed

  @scenario:prompt-stash.cursor-insertion
  Scenario: Insert saved text at the composer cursor without sending
    Given the isolated plugin profile "@dshfiles/prompt-stash" is booted
    When the composer contains "Before After" with its cursor before "After"
    And the prompt library is opened
    And a saved prompt "Reusable phrase" with text "middle " is created
    When the saved prompt "Reusable phrase" is inserted
    Then the composer contains "Before middle After" and confirms no message was sent

  @scenario:prompt-stash.recent-user-messages
  Scenario: Explain when the isolated conversation has no recent user messages
    Given the isolated plugin profile "@dshfiles/prompt-stash" is booted
    When the prompt library is opened
    And the recent messages tab is opened
    Then the recent list explains that no sent text prompts are loaded

  @scenario:prompt-stash.draft-limits
  Scenario: Save and restore a text-only draft without sending it
    Given the isolated plugin profile "@dshfiles/prompt-stash" is booted
    When the empty draft panel is opened
    Then saving is disabled for an empty draft and sent history is empty
    When the composer text "Draft body to keep" is saved as "Planning prompt"
    Then saving leaves the current composer text unchanged
    When the composer is cleared and the saved draft "Planning prompt" is restored
    Then the draft is restored without sending and can be removed
