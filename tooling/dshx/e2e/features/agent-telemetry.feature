Feature: Agent telemetry

  A loopback Command Code fake answers a thread's turn by calling a dshx-bound
  plugin tool and delegating to a subagent that runs bash. Agent telemetry
  exports the turn through dshx tracing to the Traces receiver of the same
  Host, with no OTLP environment variable.

  @scenario:agent-telemetry.turn-trace-journey @scenario:agent-telemetry.tool-nesting-journey @scenario:agent-telemetry.subagent-trace-journey
  @scenario:agent-telemetry.background-job-journey
  Scenario: A turn with a plugin tool and a subagent is one nested trace
    Given the isolated Agent telemetry profile is booted with the Traces receiver on a free port
    When a Command Code account backed by a local fake provider is added
    And a new thread asks the model for a plugin tool and a subagent
    Then the Traces panel lists the turn as a trace of the thread
    And its waterfall nests the plugin API under its tool and the subagent turn under the subagent tool
    And the subagent's bash call holds the background job it started
