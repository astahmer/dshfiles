Feature: Localhost remains available with LAN access

  The same stock Host serves both origins without replacing authentication or routing.

  @smoke @scenario:loopback-access.authenticated-lan-and-localhost
  Scenario: LAN and localhost share the authenticated app while hostile origins remain blocked
    Given the isolated LAN-bound localhost-access profile is booted
    Then LAN and localhost retain native authentication and browser-origin fencing

  @smoke @scenario:loopback-access.network-access-settings
  Scenario: Network choices save without disconnecting and apply at the next startup
    Given the isolated managed Network access profile is booted
    Then network choices are staged safely and loaded at the next isolated startup
