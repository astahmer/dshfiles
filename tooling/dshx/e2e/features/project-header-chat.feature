Feature: Project header chat creation

  These journeys register synthetic projects and seed their conversations through
  the supported Host API in a disposable profile. New chats are opened through
  the real project header controls, never through a mocked creation handler.

  @scenario:thread-sidebar.project-header-chat
  Scenario: Create a chat in a collapsed project while another project is open
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When two local projects have conversations and the sidebar is grouped by project
    Then the project header plus creates in its own project without toggling collapse
    And the project header plus works with keyboard activation and a narrow sidebar
