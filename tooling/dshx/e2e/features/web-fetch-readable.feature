Feature: Readable web fetch

  The readable fetch provider activates in a real Host and is listed as a
  running component. A real fetch is not journeyed: scratch Hosts have no
  external network (see the Host egress guard).

  @scenario:web-fetch-readable.activates
  Scenario: The readable fetch provider is installed and running
    Given the isolated plugin profile "@dshfiles/web-fetch-readable" is booted
    When the readable web fetch plugin is opened in the Plugins panel
    Then its fetch provider component is running
