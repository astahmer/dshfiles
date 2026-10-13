Feature: Activity timeline

  The Activity panel observes the Host's session events; a turn that fails for
  want of provider credentials gives it routine events and one error.

  @scenario:activity-timeline.feed-browser-journey
  Scenario: Browse, search and filter the activity feed
    Given the isolated plugin profile "@dshfiles/activity-timeline" is booted
    When a thread runs a turn that fails for want of credentials
    And the Activity panel is opened
    Then the feed lists the session events in order with their provenance
    And search and the source filter narrow the feed, and it survives a reload

  @scenario:activity-timeline.condensation-browser-journey
  Scenario: Routine events condense while attention stays visible
    Given the isolated plugin profile "@dshfiles/activity-timeline" is booted
    When a thread runs a turn that fails for want of credentials
    And the Activity panel is opened
    Then routine events stay condensed while the error stays visible on its own
