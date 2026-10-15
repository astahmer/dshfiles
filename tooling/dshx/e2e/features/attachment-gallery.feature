Feature: Attachment gallery and intake

  The attachment presentation replaces the stock plugin without patching DSH
  core. Images can enter through the picker, clipboard, or file drop, then previews keep source order and offer keyboard and thumbnail navigation.

  @scenario:attachment-gallery.gallery-navigation
  Scenario: Navigate between draft image attachments
    Given the isolated plugin profile "@dshfiles/attachment-gallery" is booted
    When a new thread is opened with two image attachments
    And the first draft image is opened
    Then the lightbox shows the first image and its thumbnail strip
    When the right arrow key is pressed in the lightbox
    Then the second image is selected
    When the first lightbox thumbnail is selected
    Then the first image is selected

  @scenario:attachment-gallery.intake-flows
  Scenario: Paste and drop images into the composer
    Given the isolated plugin profile "@dshfiles/attachment-gallery" is booted
    When an image is pasted into a new thread composer
    Then the pasted image appears in the attachment rail
    When the pasted image is removed and another image is dropped
    Then the dropped image appears in the attachment rail
