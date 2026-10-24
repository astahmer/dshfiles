Feature: Localhost remains available with LAN access

  The same stock Host serves both origins without replacing authentication or routing.

  @smoke @scenario:loopback-access.authenticated-lan-and-localhost
  Scenario: LAN and localhost share the authenticated app while hostile origins remain blocked
    Given the isolated LAN-bound localhost-access profile is booted
    Then LAN and localhost retain native authentication and browser-origin fencing
