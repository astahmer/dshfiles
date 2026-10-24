Feature: Trace and transcript links

  A span opens its thread's Chat on the turn, step or tool call it belongs to,
  and a turn's footer opens the thread's Traces tab on that turn's trace. Agent
  telemetry exports a real turn of a loopback Command Code fake to the Traces
  receiver of the same Host; the owned Chat fork scrolls to and highlights the
  row. List-price cost (dshx.cost.usd) shows for the thread, its turns, a span
  and each model.

  @scenario:traces.turn-trace-button-journey @scenario:traces.show-in-chat-journey @scenario:chat.focus-from-trace-journey
  @scenario:traces.open-thread-focus-journey
  Scenario: A turn and its trace link both ways
    Given the isolated trace-link profile is booted with agent telemetry, Chat and the Traces receiver
    When a Command Code account backed by a local fake provider is added
    And a new thread asks the fake model to run a bash command
    And the turn footer's Trace button is clicked
    Then the thread Traces tab opens the waterfall of that turn's trace
    When Show in chat is clicked on the bash tool span
    Then Chat scrolls to the bash tool call and highlights it
    When the Traces panel opens the turn's trace and Open thread is clicked on its model call
    Then the thread opens in Chat with that turn highlighted

  @scenario:traces.cost-display-journey
  Scenario: List-price cost shows for the thread, each turn, a span and each model
    Given the isolated Traces profile with "@dshfiles/ai-accounts" is booted with the receiver on a free port
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "price this"
    And the thread Traces tab is opened
    And priced synthetic turn spans tagged with this thread are posted to the receiver
    Then the thread Traces tab shows the thread's total cost and each turn's cost
    And the model call span shows its own cost
    And the Traces panel overview lists the model's calls, tokens and cost
