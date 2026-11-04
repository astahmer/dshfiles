Feature: Backlog secret links

  An item may name a credential as `secret:ALIAS`. The Secret Catalog reveals
  it in place through its own reveal verb; the fake secret CLI holds synthetic
  values only.

  @fake-secret-cli
  @scenario:backlog.secret-link-reveal
  Scenario: Reveal an item's secret link in place and hide it again
    Given the isolated plugin composition of "@dshfiles/backlog, @dshfiles/secret-catalog" is booted
    When the Backlog panel is opened
    And "Rotate the deploy key secret:GITHUB_TOKEN after secret:UNKNOWN_KEY" is captured
    And backlog item b:1 is opened
    Then the secret link "GITHUB_TOKEN" stays masked until revealed
    When the secret link "GITHUB_TOKEN" is revealed
    Then the item detail shows the value of "GITHUB_TOKEN"
    When the revealed secret "GITHUB_TOKEN" is hidden
    Then the item detail no longer shows the value of "GITHUB_TOKEN"
    And the secret link "UNKNOWN_KEY" offers the Secret Catalog instead of a value
