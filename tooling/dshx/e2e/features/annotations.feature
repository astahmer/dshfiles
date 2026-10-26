Feature: Element annotations in the composer

  Point at an element of the running DSH UI, write a note, and get a bounded,
  source-linked block in the composer draft. The block is never sent by the
  plugin, and the annotation stays pending until the Agent acknowledges or
  resolves it.

  @scenario:annotations.pick-and-insert
  Scenario: Pick an element and add its annotation to the draft
    Given the isolated plugin profile "@dshfiles/annotations" is booted
    Then the composer shows the annotate action
    When the element picker starts and the composer is picked
    Then the comment form describes the picked element
    When the annotation note "the tab strip overlaps the sidebar" is added
    Then the annotation is listed with the note "the tab strip overlaps the sidebar"
    And the annotation is linked to its source file
    When the annotations are added to the draft
    Then the composer draft holds the annotation block

  @scenario:annotations.preview-element
  Scenario: Annotate an element inside an HTML preview
    Given the isolated plugin profile "@dshfiles/annotations" is booted
    When the HTML preview dialog opens the fixture page
    Then the annotated preview shows the fixture page
    When the fixture button is annotated with "the preview button is clipped"
    Then the preview annotation is linked to the fixture file

  @scenario:annotations.extension-intake
  Scenario: Attach an extension annotation to this thread
    Given the isolated plugin profile "@dshfiles/annotations" is booted
    When the extension pairs with DSH
    And the extension posts an annotation with that token
    Then the panel lists the unassigned extension annotation
    When the unassigned annotation is added to this thread
    Then the annotation joins this thread

  @scenario:annotations.chrome-tab
  Scenario: Pick an element in a launched Chrome without an extension
    Given the annotations profile is booted with a headless picker browser
    When Chrome is launched with the fixture page open
    And the active tab is picked and the fixture button is clicked with "the fixture button is clipped"
    Then the annotation comes from the Chrome tab with "the fixture button is clipped"
    When the picker browser is stopped
    Then the picker browser is gone
