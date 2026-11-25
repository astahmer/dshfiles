Feature: Backlog Gitea provider

  The Gitea provider plugin adds Gitea connections to Backlog settings ›
  Remote sync. These journeys talk to a loopback fake Gitea through the
  connection's API base URL and never reach a real instance.

  @scenario:backlog-gitea.connect-bind-import-close
  Scenario: Connect Gitea, bind its repository, import an issue and close it by marking the item done
    Given a fake Gitea instance holds the issue "Ship the Gitea provider"
    And the backlog is booted with the Gitea provider against the fake Gitea
    When the Backlog panel is opened
    And the Backlog settings are opened
    And a Gitea connection to the fake Gitea is tested and saved
    Then the Gitea connection names its account and repository
    When the Gitea repository is bound
    And the fake Gitea issue "acme/app#1" is imported
    Then the backlog shows the imported Gitea issue "Ship the Gitea provider"
    When the imported Gitea issue is marked done and synced
    Then the fake Gitea issue is closed
