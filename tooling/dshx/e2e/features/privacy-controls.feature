Feature: Feedback and privacy controls

  The isolated Web profile keeps feedback capture and both upload paths off by
  default. Each can be controlled from Settings, the master action changes only
  feedback and uploads, and local session-log downloads remain independent.
  Uploads are enabled only inside this scratch profile; the journey creates no
  feedback event or model request that could send session data.

  @scenario:privacy-controls.individual-switches
  Scenario: Change feedback and upload switches without changing log downloads
    Given the privacy-controls profile is booted with feedback and uploads off
    When Settings is opened from the sidebar
    And the Feedback & privacy section is opened
    Then all feedback and upload switches are off and downloads are on
    And Answer feedback UI requires Session feedback capture
    When Session feedback capture is enabled
    And Answer feedback UI is enabled
    Then Session feedback capture cannot be disabled while Answer feedback UI is on
    When Answer feedback UI is disabled
    And Session feedback capture is disabled
    And OpenTelemetry session upload is enabled
    And Official DeepSeek session-log upload is enabled
    When all feedback and uploads are disabled
    Then disabling all leaves session-log downloads on
    When session-log downloads are disabled
    And all feedback and uploads are enabled
    Then all feedback and upload switches are on and downloads are off
    When all feedback and uploads are disabled
    Then all feedback and upload switches are off and downloads are off
    When session-log downloads are enabled
    Then enabling session-log downloads leaves feedback and uploads off
    And the privacy controls page stays mounted without client or Slot errors
