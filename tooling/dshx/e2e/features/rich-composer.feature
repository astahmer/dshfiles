Feature: Rich composer paste

  The owned native composer preserves session mentions as structured reference chips when pasted.

  @scenario:rich-composer.paste-session-mention
  Scenario: Paste a thread mention into the composer
    Given the isolated plugin profile "@dshfiles/rich-composer" is booted
    When a canonical thread mention is pasted into a new thread composer
    Then the pasted mention is displayed as a reference chip
