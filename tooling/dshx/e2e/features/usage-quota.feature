Feature: Usage › Quota

  Observe › Usage is one page with Cost, Quota, Requests and Tools tabs. Its Quota
  tab draws the quota views AI Accounts provides (one account, history, forecast),
  which used to be pages of their own. With no account configured, each view says
  what to add instead of inventing a reading.

  @scenario:usage.quota-tab
  Scenario: Quota history and forecast are views of the Usage page
    Given the isolated plugin composition of "@dshfiles/usage, @dshfiles/ai-accounts" is booted
    When the Usage page is opened on its Quota tab
    Then the Quota tab offers the accounts, history and forecast views of AI Accounts
