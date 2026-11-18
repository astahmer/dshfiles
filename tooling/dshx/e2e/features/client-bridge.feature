Feature: Agents act in the DSH window

  An Agent runs on the Host, so a Host tool cannot open Settings in the user's
  browser. Settings declares settings_open as a client tool; the client bridge
  carries the Agent's client_tool_call to this window, which runs it, shows a
  notice and returns the result. The loopback Command Code fake asks for each
  call through its `[[call …]]` directive and records the tool results.

  @scenario:client-bridge.agent-opens-settings
  Scenario: An agent lists the window's client tools and opens Settings at a section
    Given the isolated plugin composition of "@dshfiles/client-bridge,@dshfiles/ai-accounts,@dshfiles/settings-shell,@dshfiles/dialogs" is booted
    When a Command Code account backed by a local fake provider is added
    And a new thread on the fake model lists the client tools
    Then the agent sees this window offer the client tool "settings_open"
    When the thread calls the client tool "settings_open" for the Settings section "General"
    Then Settings is open in the window with a notice naming "Open Settings"
    And the agent received the opened Settings section "general"

  @scenario:client-bridge.refuses-unknown-tool
  Scenario: A client tool no window offers is refused with the names it does offer
    Given the isolated plugin composition of "@dshfiles/client-bridge,@dshfiles/ai-accounts,@dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And a new thread on the fake model calls the client tool "nope_open"
    Then the agent is told no window offers "nope_open" and that it offers "settings_open"

  @scenario:client-bridge.code-mode-chain
  Scenario: A PTC-mode agent chains client tools from one run_code program
    Given the isolated plugin composition of "@dshfiles/client-bridge,@dshfiles/ai-accounts,@dshfiles/settings-shell,@dshfiles/dialogs,@dshfiles/agent-preset,@dshfiles/tool-search" is booted
    When a Command Code account backed by a local fake provider is added
    And PTC mode is the new task default
    And a new thread on the fake model runs a program that lists the client tools and chains "settings_sections" then "settings_open" for "General"
    Then the program returned both step results from one window
    And Settings is open in the window with a notice naming "Open Settings"
    And the client bridge journey is recorded

  @scenario:command-palette.agent-runs-palette-command
  Scenario: An agent runs a command palette command in the user's window
    Given the isolated plugin composition of "@dshfiles/client-bridge,@dshfiles/ai-accounts,@dshfiles/settings-shell,@dshfiles/dialogs,@dshfiles/command-palette" is booted
    When a Command Code account backed by a local fake provider is added
    And a new thread on the fake model finds the palette command "Open Settings" and runs it
    Then Settings is open in the window with a notice naming "Run a palette command"
    And the agent received the palette command it ran
