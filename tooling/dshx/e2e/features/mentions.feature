Feature: Ranked @ mentions

  The @ menu is @dshfiles/mentions' own source over the native file and
  thread lookups. Turns fail for lack of a provider; the threads exist only
  to be mentioned.

  @scenario:mentions.ranked-mentions
  Scenario: An exact thread title leads the menu, and scopes narrow it
    Given the isolated plugin profile "@dshfiles/mentions" is booted
    When threads named "deploy" and "fix the deploy script" are started
    And a new thread composer types "@deploy"
    Then the first mention row is the thread "deploy" under the heading "Threads & files · @t: threads · @f: files"
    When a new thread composer types "@t:"
    Then only thread rows are listed under the heading "Threads · @f: files"
    When a new thread composer types "@f:"
    Then no thread row is listed under the heading "Files · @t: threads"
    When the highlighted mention row is picked with the keyboard
    Then the composer holds a native reference chip
