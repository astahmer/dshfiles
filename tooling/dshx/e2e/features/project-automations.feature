Feature: Project automations start threads on a schedule or from a signed webhook

  Work › Automations creates per-project automations. A schedule that runs every
  minute starts a new thread in its project on its own; a webhook automation
  starts one when a request signed with its referenced secret arrives. The
  loopback Command Code fake answers each thread, and the fake secret CLI holds
  the signing secret.

  @scenario:project-automations.schedule-fires
  Scenario: An every-minute schedule starts a thread that opens from its run
    Given the isolated plugin composition of "@dshfiles/project-automations, @dshfiles/session-controller, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a scratch project "automations-schedule" is registered
    And a schedule automation "Minute check" that runs every minute on the fake model is created
    Then the automation starts a thread on its own and the thread opens on its answer
    And pausing the automation shows that no run is planned

  @fake-secret-cli
  @scenario:project-automations.webhook-thread
  Scenario: A signed webhook request starts a thread with the templated prompt
    Given the isolated plugin composition of "@dshfiles/project-automations, @dshfiles/session-controller, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/secret-catalog" is booted
    When a Command Code account backed by a local fake provider is added
    And a scratch project "automations-webhook" is registered
    And a webhook automation "CI failed" signed with "secret:GITHUB_TOKEN" is created
    Then an unsigned request to its webhook URL is refused
    When a request signed with that secret posts a payload to its webhook URL
    Then the webhook run's thread answers with the value from the payload
