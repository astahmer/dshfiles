Feature: Backlog Notion provider

  The Notion provider plugin adds Notion connections to Backlog settings ›
  Remote sync. These journeys talk to a loopback fake Notion through the
  connection's API base URL and never reach api.notion.com.

  @scenario:backlog-notion.connect-bind-import
  Scenario: Connect Notion, bind its data source with a property name, and import a page
    Given a fake Notion workspace holds the page "Ship the Notion provider"
    And the backlog is booted with the Notion provider against the fake Notion
    When the Backlog panel is opened
    And the Backlog settings are opened
    And a Notion connection to the fake Notion is tested and saved
    Then the Notion connection names its bot and data source
    When the Notion data source is bound with the status property "Status"
    And the fake Notion page is imported
    Then the backlog shows the imported Notion page "Ship the Notion provider"
