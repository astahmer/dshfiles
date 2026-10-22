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

  @scenario:secret-catalog.quick-add
  Scenario: Add secrets inline under the list, typed or generated
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog is opened
    And the seeded project folder is chosen in the Secret Catalog
    And "stripe key" is typed into a new inline row with the value "quick-e2e-typed-value" and saved with Enter
    Then the store holds "STRIPE_KEY" in the "project" scope with the value "quick-e2e-typed-value"
    When an inline row named "db password" is left by clicking elsewhere
    Then the inline row says "DB_PASSWORD already exists in prod."
    When the inline row is renamed "WEBHOOK_SECRET", set to Generate, and left by clicking elsewhere
    Then the store holds a generated value for "WEBHOOK_SECRET" in the "project" scope that the page never showed
    When a new inline row is deleted from its row menu
    Then no inline row is left

  @scenario:secret-catalog.add-dialog
  Scenario: The add dialog validates inline and generates a global secret on the Host
    Given the isolated plugin profile "@dshfiles/secret-catalog" is booted
    When the Secret Catalog is opened
    And the seeded project folder is chosen in the Secret Catalog
    And the add dialog is opened from the Add secret menu
    Then the dialog flags "1BAD" as "Start with a letter or _, then use letters, digits, _ or -." and keeps Advanced folded
    And the dialog flags "DB_PASSWORD" as "DB_PASSWORD already exists in prod." and keeps Advanced folded
    When "GLOBAL_TOKEN" is added to the global scope with a generated value
    Then the store holds a generated value for "GLOBAL_TOKEN" in the "global" scope that the page never showed
    And the dialog journey is complete

  @scenario:secret-catalog.backlog-jev-setup
  Scenario: Add a Jev key from its Backlog setting and bind only its reference
    Given the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/backlog, @dshfiles/secret-catalog" is booted
    And a project-scoped Jev key is stored for the seeded project folder
    When the Backlog Jev secret setup is opened from Settings
    And the Jev API key "jev-e2e-sensitive-value" is entered and saved
    Then the global Jev secret is stored with value "jev-e2e-sensitive-value" without exposing it in the UI

  @scenario:secret-catalog.backlog-jev-setup-replace
  Scenario: Replace an existing global Jev key from its Backlog setting
    Given a global Jev key with value "jev-e2e-existing-value" is already stored
    And the isolated plugin composition of "@dshfiles/settings-shell, @dshfiles/backlog, @dshfiles/secret-catalog" is booted
    When the Backlog Jev secret setup is opened from Settings
    Then the replacement warning is shown before saving the Jev key
    When the Jev API key "jev-e2e-replacement-value" is entered and saved
    Then the global Jev secret is stored with value "jev-e2e-replacement-value" without exposing it in the UI

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
