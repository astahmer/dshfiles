Feature: Attachment gallery navigation

  The attachment presentation replaces the stock plugin without patching DSH
  core. Image previews keep source order and offer keyboard and thumbnail navigation.

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
