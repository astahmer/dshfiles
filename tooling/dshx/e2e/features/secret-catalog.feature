@fake-secret-cli
Feature: Secret Catalog

  A fake secret CLI first on the Host's PATH serves synthetic aliases from a
  JSON store, so every listing, reveal and mutation is read back from it.

  @scenario:secret-catalog.scope-filter
  @scenario:secret-catalog.project-picker
  Scenario: Browse aliases by scope once a project folder is chosen
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog is opened
    Then only global aliases are listed until a project folder is chosen
    When the seeded project folder is chosen in the Secret Catalog
    Then the "all" scope lists 4 aliases
    When the scope filter is set to "project"
    Then the "project" scope lists 2 aliases
    When the scope filter is set to "global"
    Then the "global" scope lists 1 aliases
    When the scope filter is set to "local"
    Then the "local" scope lists 1 aliases
    When the scope filter is set to "all"
    Then filtering by "LOCAL_TOKEN" keeps only the matching alias

  @scenario:secret-catalog.load-failure
  Scenario: A failing secret CLI shows its error without an empty catalog
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the fake secret CLI store is unreadable
    And the Secret Catalog is opened
    Then only the load error is shown, without an empty catalog

  @scenario:secret-catalog.reveal-expiry
  Scenario: Reveal one value on click, briefly, and copy it without showing it
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog reveals values for 3 seconds
    And the Secret Catalog is opened
    And the seeded project folder is chosen in the Secret Catalog
    Then the dev DB_PASSWORD reveals on click, hides on timeout and blur, and copies without revealing

  @scenario:secret-catalog.add-edit
  Scenario: Add a project alias with a typed value, then edit its source and value
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog is opened
    And the seeded project folder is chosen in the Secret Catalog
    And the alias "API_KEY" is added to the project with the value "api-e2e-typed-value"
    Then the store holds "API_KEY" with the value "api-e2e-typed-value" and the source "https://api.example.test"
    When "API_KEY" gets the source "https://api.example.test/v2" and the value "api-e2e-edited-value"
    Then the store holds "API_KEY" with the value "api-e2e-edited-value" and the source "https://api.example.test/v2"

  @scenario:secret-catalog.rename-remove
  Scenario: Rename an alias, remove another, and delete a vault item
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog is opened
    And the seeded project folder is chosen in the Secret Catalog
    And the vault item behind "DB_PASSWORD" in "dev" is deleted
    And "DB_PASSWORD" is renamed to "DATABASE_PASSWORD"
    And the alias "GITHUB_TOKEN" is removed while its vault item stays
    Then the store renamed the alias, dropped GITHUB_TOKEN but kept its item, and deleted the dev item

  @scenario:secret-catalog.agent-tools
  Scenario: Agents list aliases without values and read one exact alias
    Given the isolated plugin composition of "@dshfiles/secret-catalog, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And a thread in the seeded project asks the fake model to "[[call secret_list {}]]"
    Then the tool result "contains" "alias DB_PASSWORD · project · dev"
    And the tool result "omits" "db-e2e"
    When a thread in the seeded project asks the fake model to "[[call secret_get {\"alias\":\"DB_PASSWORD\",\"environment\":\"dev\"}]]"
    Then the tool result "contains" "db-e2e-dev-value"
    When a thread in the seeded project asks the fake model to "[[call secret_get {\"alias\":\"MISSING_ALIAS\"}]]"
    Then the tool result "contains" "No secret alias MISSING_ALIAS is configured for environment prod."
    And the secret tools journey is complete
