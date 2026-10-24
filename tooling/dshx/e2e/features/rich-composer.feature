Feature: Rich composer references

  The owned native composer preserves structured references from pasted mentions and image attachments.

  @scenario:rich-composer.paste-session-mention
  Scenario: Paste a thread mention into the composer
    Given the isolated plugin profile "@dshfiles/rich-composer" is booted
    When a canonical thread mention is pasted into a new thread composer
    Then the pasted mention is displayed as a reference chip

  @scenario:rich-composer.image-attachment-reference
  Scenario: Attach an image and refer to it inline
    Given the isolated plugin profile "@dshfiles/rich-composer" is booted
    When an image is attached to a new thread composer
    Then the image is represented by an inline composer reference
