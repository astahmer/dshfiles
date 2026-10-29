Feature: Deny policies

  A rule written in Settings refuses a matching tool call after every
  permission. The loopback Command Code fake asks for a `bash` call through its
  `[[call …]]` directive and records the tool result the Host sends back.

  @scenario:policies.denied-call
  Scenario: A rule from Settings denies a matching bash call and lets another through
    Given the isolated plugin composition of "@dshfiles/policies,@dshfiles/ai-accounts,@dshfiles/settings-shell" is booted
    When a Command Code account backed by a local fake provider is added
    And the deny rule "no proof files" for bash calls matching "policy-proof" is saved in Settings
    And a new thread on the fake model asks bash to write "policy-proof.txt"
    Then the bash call is refused with the "no proof files" policy
    When the thread asks bash to echo "allowed-by-policy"
    Then the bash call ran and returned "allowed-by-policy"
