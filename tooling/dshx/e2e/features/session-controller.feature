Feature: Another plugin drives a thread through the sessions API

  The session-controller fork's sessions API starts a thread, prompts it, keeps
  an instruction in its prompt and adds a plugin message that wakes it, on the
  same native path the Chat UI uses.

  @scenario:session-controller.drive-threads
  Scenario: A thread started through the sessions API is listed and runs its turns
    Given the isolated plugin composition of "@dshfiles/session-controller, @dshfiles/ai-accounts" is booted
    When a Command Code account backed by a local fake provider is added
    And a plugin starts a titled thread with a first prompt through the sessions API
    Then the thread is listed and opens on the answer to that prompt
    When the plugin adds an instruction and a message that wakes the thread
    Then the woken turn answers in the open thread and its request carried the instruction
