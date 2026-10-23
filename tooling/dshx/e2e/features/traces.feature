Feature: Traces

  The Traces panel runs a local OTLP/HTTP receiver. A synthetic OTLP JSON
  export with a server span, a nested client span that fails and a span from a
  second service is posted to it, the way any OpenTelemetry exporter would.

  @scenario:traces.receiver-browser-journey @scenario:traces.waterfall-browser-journey
  Scenario: A posted OTLP export shows as a trace with a span waterfall
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    Then the receiver shows where it listens and how to send it telemetry
    When a synthetic OTLP JSON export is posted to the receiver
    Then the trace list shows the exported trace with its error count
    And opening the trace renders the nested span waterfall with the failing span in red
    And selecting a span shows its attributes and resource attributes

  @scenario:traces.insights-browser-journey
  Scenario: Operations and error groups summarize the stored spans
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And a synthetic OTLP JSON export is posted to the receiver
    Then the Operations tab lists each operation with its count and error rate
    And the Errors tab groups the failing span with a sample trace

  @scenario:traces.logs-browser-journey
  Scenario: Logs correlate with their trace and span both ways
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And a synthetic OTLP JSON export is posted to the receiver
    And synthetic OTLP JSON logs for that trace are posted to the receiver
    Then the Logs tab lists the records and filters them by severity and attribute
    And a log record opens its trace
    And the failing span shows only its own logs
