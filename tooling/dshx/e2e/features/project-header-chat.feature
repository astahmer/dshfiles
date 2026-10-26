Feature: Project header chat creation

  These journeys register synthetic projects and seed their conversations through
  the supported Host API in a disposable profile. New chats are opened through
  the real project header controls, never through a mocked creation handler.

  @scenario:thread-sidebar.project-header-chat
  Scenario: Create a chat in a collapsed project while another project is open
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When two local projects have conversations and the sidebar is grouped by project
    Then the project header plus creates in its own project without toggling collapse
    And the project header plus works with keyboard activation and a narrow sidebar

  @scenario:thread-sidebar.project-header-drafts
  Scenario: Save multiple unsent chats per project on typing without saving empty chats
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When two local projects have conversations and the sidebar is grouped by project
    Then typing saves independent unsent project chats that reopen from All threads
    And sending one draft leaves other unsent chats intact and New chat stays fresh

  @scenario:thread-sidebar.pretyping-draft-choices @scenario:model-selection.pretyping-draft-choices @scenario:agent-preset.pretyping-draft-choices
  Scenario: Choose model and preset before typing without saving an empty chat
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When two local projects have conversations and the sidebar is grouped by project
    Then model and preset choices remain local until typing creates the chat

  @scenario:thread-sidebar.custom-draft-picker
  Scenario: The installed compact model picker preserves local draft choices
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/workspace-nav, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/model-selection, @dshfiles/agent-preset, @dshfiles/model-effort-picker, @dshfiles/ai-accounts, @dshfiles/multi-host, @dshfiles/jj-integration" is booted
    When two local projects have conversations and the sidebar is grouped by project
    Then the compact model picker stages its selection without creating an empty chat
