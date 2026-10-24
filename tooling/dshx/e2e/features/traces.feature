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
    And the span detail panel stays visible while scrolling the trace view

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

  @scenario:traces.service-map-browser-journey
  Scenario: The service map draws calls between services
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And a synthetic OTLP JSON export is posted to the receiver
    Then the service map shows both services and the call between them
    And picking a service on the map filters the trace list by it

  @scenario:traces.metrics-browser-journey
  Scenario: Exported metrics list with one chart each
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And two synthetic OTLP JSON metric exports are posted to the receiver
    Then the Metrics tab lists each metric with its type and last value
    And selecting a counter charts its increase between exports

  @scenario:traces.self-telemetry-browser-journey
  Scenario: The Host's own telemetry arrives without an OTEL environment variable
    Given the isolated Traces profile with "@dshfiles/usage" is booted with the receiver on a free port
    When the Traces panel is opened
    Then this Host's own plugin spans arrive without any OTEL environment variable

  @scenario:traces.thread-tab-browser-journey
  Scenario: A thread's Traces tab shows only that thread's telemetry
    Given the isolated Traces profile with "@dshfiles/ai-accounts,@dshfiles/usage" is booted with the receiver on a free port
    When a Command Code account backed by a local fake provider is added
    And a thread on the fake model is asked "first question"
    And the thread Traces tab is opened
    Then the thread Traces tab says nothing was exported for this thread yet
    When synthetic agent turn spans tagged with this thread are posted to the receiver
    Then the thread Traces tab summarizes only this thread's telemetry
    And a turn opens its span waterfall with the plugin span nested under the tool call
    And the thread logs list only its own records
    And the thread Requests tab lists only its requests
    And the thread Traces tab fits a 480 px wide window
