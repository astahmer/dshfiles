Feature: Rich composer references

  The owned native composer preserves structured references from pasted mentions and image attachments.

  @scenario:rich-composer.paste-session-mention
  Scenario: Paste a thread mention into the composer
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When a canonical thread mention is pasted into an active thread composer
    Then the pasted mention is displayed as a reference chip

  @scenario:rich-composer.image-attachment-reference
  Scenario: Attach an image and refer to it inline
    Given the isolated rich-composer, input-trigger and attachment-gallery plugin profile is booted
    When an image is attached to a new thread composer
    Then the image is represented by an inline composer reference

  @scenario:rich-composer.image-reference-mentions
  Scenario: Reuse an image reference and open the selected image
    Given the isolated rich-composer, input-trigger and attachment-gallery plugin profile is booted
    When an image is attached to a new thread composer
    Then an image reference can be mentioned repeatedly and opens its selected image

  @scenario:rich-composer.composer-contract
  Scenario: A plugin writes the draft and adds chips through the Composer contract
    Given the isolated plugin composition of "@dshfiles/rich-composer, @dshfiles/input-trigger, @dshfiles/session-controller" is booted
    When a plugin sets the draft and attaches a quote, a note and a file through the Composer contract
    Then the composer shows the draft with the quote, note and file chips

  @scenario:rich-composer.prompt-recall
  Scenario: Recall this thread's earlier prompts with ArrowUp
    Given the isolated plugin composition of "@dshfiles/rich-composer, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When a thread with two sent prompts is opened
    Then ArrowUp recalls them newest first, ArrowDown walks back and Escape restores the empty draft

  @scenario:rich-composer.large-paste
  Scenario: A large paste becomes a text file that can go back to text
    Given the isolated plugin composition of "@dshfiles/rich-composer, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When 40 KiB of text is pasted into a thread composer
    Then the paste is a text file attachment that Paste as text turns back into text
