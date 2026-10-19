Feature: Ranked @ mentions and thread links

  The @ menu is @dshfiles/mentions' own source over the native file and
  thread lookups. Turns fail for lack of a provider; the threads exist only
  to be mentioned.

  @scenario:mentions.ranked-mentions
  Scenario: An exact thread title leads the menu, and scopes narrow it
    Given the isolated plugin profile "@dshfiles/mentions" is booted
    When threads named "deploy" and "fix the deploy script" are started
    And a new thread composer types "@deploy"
    Then the first mention row is the thread "deploy" under the heading "Threads & files · @t: threads · @f: files · @skill: · @mcp: · @b: backlog"
    When a new thread composer types "@\"fix the"
    Then a mention row includes the thread "fix the deploy script"
    When a new thread composer types "@t:"
    Then only thread rows are listed under the heading "Threads · @f: files"
    When a new thread composer types "@f:"
    Then no thread row is listed under the heading "Files · @t: threads"
    When the highlighted mention row is picked with the keyboard
    Then the composer holds a native reference chip

  @scenario:mentions.session-mention-links
  Scenario: Referenced threads open from the sent message, in a new tab on Cmd-click
    Given the isolated plugin composition of "@dshfiles/mentions, @dshfiles/main-tabs" is booted
    When threads named "Mention target" and "Second thread" are started
    And a new thread mentions "Mention target" and is sent
    Then the sent message links to "Mention target"
    When the "Referenced session" link is clicked
    Then the thread "Mention target" is shown
    When the sending thread is shown again and its thread chip is Cmd-clicked
    Then the thread "Mention target" is shown in a tab of its own

  @scenario:mentions.skill-and-mcp-scopes
  Scenario: Skills share the @ menu with threads and files, and each scope keeps its own rows
    Given the isolated plugin composition of "@dshfiles/mentions, @dshfiles/thread-sidebar" is booted with the autocomplete skill fixture
    When threads named "e2e skill notes" and "unrelated work" are started
    And a new thread composer types "@e2e"
    Then the skill "e2e-skill-mentions" and the thread "e2e skill notes" are both offered
    When a new thread composer types "@skill:e2e"
    Then only the skill "e2e-skill-mentions" is offered
    When a new thread composer types "@t:e2e"
    Then the thread "e2e skill notes" is offered without the skill
