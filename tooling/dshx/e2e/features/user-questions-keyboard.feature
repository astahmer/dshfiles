Feature: Answering a question with the keyboard alone

  A real ask_user_question call from the fake model takes the composer seat.
  On a desktop pointer the recommended option holds focus as the card
  mounts, a digit chooses an option, Enter sends the answer, and focus goes
  back to the composer.

  @scenario:user-questions.keyboard-answer
  Scenario: A question is answered with the keyboard alone
    Given the isolated plugin composition of "@dshfiles/user-questions, @dshfiles/tool-ask-user, @dshfiles/html-render, @dshfiles/preview, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks a markdown question with an html preview
    Then pressing 2 then Enter answers it and the composer takes focus back
