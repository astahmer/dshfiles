Feature: Viewed marks on review files

  The fake Command Code model writes files through the real write tool, so
  each turn's review lists real changes the viewed marks attach to.

  @scenario:diff-viewed.toggle-progress
  @scenario:diff-viewed.change-scope
  Scenario: Mark review files as viewed for one turn only
    Given the isolated plugin composition of "@dshfiles/diff-viewed, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes "alpha.txt" and "beta.txt" in a fresh review workspace
    And turn 1 is reviewed
    Then the review shows "0/2 viewed"
    When "alpha.txt" is marked as viewed
    Then the review shows "1/2 viewed"
    When "beta.txt" is marked as viewed
    Then the review shows "2/2 viewed"
    When "alpha.txt" is marked as not viewed
    Then the review shows "1/2 viewed"
    When "alpha.txt" is marked as viewed
    And the fake model rewrites "alpha.txt" in a second turn
    And turn 2 is reviewed
    Then the review shows "0/1 viewed"
    And "alpha.txt" reads as "not viewed"
    And the review journey is complete

  @scenario:diff-viewed.storage-retention
  Scenario: Marks survive a reload, ignore corrupt browser storage and stay bounded
    Given the isolated plugin composition of "@dshfiles/diff-viewed, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes "alpha.txt" and "beta.txt" in a fresh review workspace
    And turn 1 is reviewed
    And "alpha.txt" is marked as viewed
    And the page is reloaded and turn 1 is reviewed
    Then the review shows "1/2 viewed"
    When the viewed marks in storage are corrupted
    And the page is reloaded and turn 1 is reviewed
    Then the review shows "1/2 viewed"
    When the viewed marks already hold 2000 older marks
    And the page is reloaded and turn 1 is reviewed
    And the Host keeps at most 2000 viewed marks
    When "beta.txt" is marked as viewed
    Then the review shows "1/2 viewed"
    And the review journey is complete

  @scenario:diff-viewed.cross-tab
  Scenario: A mark made in another tab appears without a reload
    Given the isolated plugin composition of "@dshfiles/diff-viewed, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model writes "alpha.txt" and "beta.txt" in a fresh review workspace
    And turn 1 is reviewed
    And "alpha.txt" is marked as viewed
    Then a mark made in another tab shows here without a reload
