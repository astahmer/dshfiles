Feature: Send after the attachment upload

  The upload request is held in the browser so the file stays "Uploading…"
  for as long as the scenario needs. Turns fail for lack of a provider.

  @scenario:send-after-upload.queued-send
  Scenario: Enter during an upload sends once it finishes, and an edit or Escape cancels
    Given the isolated plugin profile "@dshfiles/send-after-upload" is booted
    When a thread is started and its file upload is held
    And "deferred hello" is typed with the file attached and Enter is pressed
    Then the composer shows "Sending when upload finishes…" and keeps the draft
    When the upload finishes
    Then "deferred hello" is sent with its file
    When "second try" is typed with a held file attached and Enter is pressed
    And the draft is edited
    Then the pending send is cancelled and nothing is sent after the upload
    When Enter is pressed with a held file attached and then Escape
    Then the pending send is cancelled
    When the disabled Send button is pressed while the file uploads
    Then the Send press queues the send too
