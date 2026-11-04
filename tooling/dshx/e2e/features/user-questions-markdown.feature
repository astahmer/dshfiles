Feature: Markdown questions with sandboxed HTML previews

  A real ask_user_question call from the fake model, made through the
  forked tool-ask-user preset child the web seed composes, shows its
  question as markdown: a heading with a link, a table, an html preview that
  runs only inside the sandboxed html-render card, and option descriptions
  whose links stay links. The same form fits a phone-width pane.

  @scenario:user-questions.markdown-question @scenario:tool-ask-user.preset-child
  Scenario: A markdown question renders its body, a sandboxed preview and rich options
    Given the isolated plugin composition of "@dshfiles/user-questions, @dshfiles/tool-ask-user, @dshfiles/html-render, @dshfiles/preview, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model asks a markdown question with an html preview
    Then the question form renders the markdown heading, table and option descriptions
    And the html preview runs in a sandboxed card without network or parent access
    And clicking an option description picks it while its link stays a link
    And the question form fits a phone-width viewport
