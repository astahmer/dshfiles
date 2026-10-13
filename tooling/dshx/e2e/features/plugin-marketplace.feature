Feature: Framework Hub marketplace

  A loopback Framework Hub serves the catalog and a freshly packed bundle, so
  browsing and installing run through the real Host and DSH CLI offline.

  @scenario:plugin-marketplace.search-page
  Scenario: Search, sort and filter the Hub catalog
    Given the isolated plugin profile "@dshfiles/plugin-marketplace" is booted
    When a local Framework Hub lists three plugins and serves a packed target bundle
    And the Framework Hub tab is opened in Settings
    Then the catalog lists the Hub plugins and narrows by search, sort and compatibility

  @scenario:plugin-marketplace.hub-boundary
  Scenario: A failing Hub is reported with a retry path
    Given the isolated plugin profile "@dshfiles/plugin-marketplace" is booted
    When a local Framework Hub lists three plugins and serves a packed target bundle
    And the Hub "catalog" fails
    And the Framework Hub tab is opened in Settings
    Then the catalog reports the Hub failure and recovers on Retry without inventing plugins

  @scenario:plugin-marketplace.install-consent
  Scenario: Install a plugin after two explicit confirmations
    Given the isolated plugin profile "@dshfiles/plugin-marketplace" is booted
    When a local Framework Hub lists three plugins and serves a packed target bundle
    And the Framework Hub tab is opened in Settings
    And "Target bundle" is downloaded through both confirmations
    Then the bundle is installed into the Profile with a restart notice

  @scenario:plugin-marketplace.install-retry
  Scenario: A failed install stays retryable through the same confirmations
    Given the isolated plugin profile "@dshfiles/plugin-marketplace" is booted
    When a local Framework Hub lists three plugins and serves a packed target bundle
    And the Framework Hub tab is opened in Settings
    And the Hub "detail" fails
    And "Target bundle" is downloaded through both confirmations
    Then the install fails visibly and leaves the Profile unchanged
    When the Hub "detail" recovers
    And the failed install is retried through both confirmations again
    Then the bundle is installed into the Profile with a restart notice
