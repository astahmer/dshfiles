Feature: Traces alerts, boards and saved views

  Alert rules run on the Traces Host over the stored spans. A synthetic OTLP
  export with failing spans is posted to the receiver, a rule is created in the
  Alerts tab and evaluated, and the firing alert shows in the panel and in an
  in-app banner. Boards break agent tool spans down by tool, and a saved view
  brings a filtered trace list back.

  @scenario:traces.alerts-browser-journey
  Scenario: An error-rate rule fires on posted spans and shows wherever the user is
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And a synthetic OTLP JSON export is posted to the receiver
    And an error-rate alert rule for "e2e-checkout" is created in the Alerts tab
    And the alert rules are evaluated now
    Then the rule fires with its value and its sample trace
    And the Alerts tab and the panel banner mark the firing alert
    And an in-app banner announces the firing alert
    When the firing rule is muted for one hour
    Then the rule shows that it is muted
    When the firing rule is deleted after confirming
    Then the history shows the alert fired and was resolved by the removal

  @scenario:traces.boards-browser-journey
  Scenario: A board breaks tool calls down and a saved view brings a filter back
    Given the isolated Traces profile is booted with the receiver on a free port
    When the Traces panel is opened
    And synthetic tool call spans are posted to the receiver
    Then the Slow tools board lists each tool with its count and p95
    And a board row opens the trace list filtered to that tool
    When the current view is saved as "Bash calls"
    And the trace filters are cleared
    And the saved view "Bash calls" is applied
    Then the trace list is filtered to that tool again
