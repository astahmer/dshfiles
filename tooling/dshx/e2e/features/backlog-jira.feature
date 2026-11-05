Feature: Backlog Jira provider

  The Jira provider plugin adds Jira connections to Backlog settings ›
  Remote sync. These journeys talk to a loopback fake Jira through the
  connection's API base URL and never reach atlassian.net.

  @scenario:backlog-jira.connect-bind-import-transition
  Scenario: Connect Jira, bind its project, import an issue and sync a status change through workflow transitions
    Given a fake Jira site holds the issue "Ship the Jira provider"
    And the backlog is booted with the Jira provider against the fake Jira
    When the Backlog panel is opened
    And the Backlog settings are opened
    And a Jira connection to the fake Jira is tested and saved with its account email
    Then the Jira connection names its account and project
    When the Jira project is bound
    And the fake Jira issue "ENG-1" is imported
    Then the backlog shows the imported Jira issue "Ship the Jira provider"
    When the imported Jira issue is marked done and synced
    Then the fake Jira issue moved to Done through two transitions
