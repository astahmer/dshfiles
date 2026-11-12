Feature: Prompt stash

  These journeys use a fresh isolated browser profile and the real composer UI.
  They never call a live model/provider API; the attachment journey sends two
  messages only to create threads, and their turns fail for lack of a provider.

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
    When the composer text "Quick current prompt" is saved as a prompt
    Then current composer text "Quick current prompt" remains and prompt "Quick current prompt" is saved

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

  @scenario:prompt-stash.draft-attachments-survive-back
  Scenario: Draft attachments survive leaving the thread and coming back
    Given the isolated plugin composition of "@dshfiles/prompt-stash, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread drafts "Draft with attachments" with an image and a file attached
    And another thread is opened
    And the sidebar goes back to the drafting thread
    Then the draft still reads "Draft with attachments" with its image and file attached
    When the attachments are removed from the draft
    Then the drafting thread holds no attachments after another round trip

  @scenario:prompt-stash.prompt-history-across-threads
  Scenario: Search prompts sent in other threads, star one and insert it
    Given the isolated plugin composition of "@dshfiles/prompt-stash, @dshfiles/session-search, @dshfiles/command-palette, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread is started with the prompt "Deploy the quartz service to staging"
    And the message "Review the release notes" is sent in that thread
    When Ctrl+R is pressed in the composer
    And the prompt history is searched for "quartz"
    Then only the sent prompt "Deploy the quartz service to staging" is listed
    When the sent prompt "Deploy the quartz service to staging" is starred
    Then the saved prompts list "Deploy the quartz service to staging"
    When the prompt history is opened from the command palette at phone width
    And the sent prompt "Review the release notes" is inserted
    Then the composer holds "Review the release notes" without sending it

  # b:2cep: a panel opened from a More menu row closed itself a moment later.
  @scenario:prompt-stash.more-menu-panels-stay-open
  Scenario: Saved prompts and Prompt history opened from the More menu stay open
    Given the isolated plugin composition of "@dshfiles/prompt-stash, @dshfiles/session-search, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread is started with the prompt "Summarize the open incidents"
    When "Saved prompts" is chosen in the composer More menu
    Then the "Saved prompts" panel is still open 3 seconds later
    When a saved prompt "Morning check" with text "Check the overnight alerts." is created
    And the saved prompt "Morning check" is inserted
    Then the thread composer holds "Check the overnight alerts."
    When "Prompt history" is chosen in the composer More menu
    Then the "Prompt history" panel is still open 3 seconds later
    When the sent prompt "Summarize the open incidents" is inserted
    Then the composer holds "Summarize the open incidents" without sending it
