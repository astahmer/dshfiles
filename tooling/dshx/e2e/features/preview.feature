Feature: Thread dev servers and the agent preview browser

  A thread's bash call starts a tiny HTTP server in its workspace. The thread
  header lists the port it listens on, the agent opens and snapshots the page
  in the Host preview browser, and Stop ends the server.

  @scenario:preview.dev-server-chip
  Scenario: A server started by a thread is listed, previewed by the agent and stopped
    Given the isolated plugin composition of "@dshfiles/preview, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model starts an HTTP server from bash in a fresh workspace
    Then the thread header lists the server's port
    When the fake model opens and snapshots the server page in the preview browser
    Then the preview page is listed beside the server and its snapshot holds the page text
    And stopping the server from the thread header ends its process
