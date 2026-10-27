Feature: Dialogs

  The isolated dialogs bundle provides the dshx Dialogs and Toasts contracts on
  the page broker. A plugin's call opens the app's own dialog and toast instead
  of the browser's.

  @scenario:dialogs.confirm
  Scenario: A plugin confirms a destructive action in the app dialog
    Given the isolated plugin profile "@dshfiles/dialogs" is booted
    When a plugin asks to confirm deleting "Old draft"
    Then the app dialog asks about "Old draft" with focus on Cancel
    When the user presses "Delete"
    Then the plugin receives the answer true

  @scenario:dialogs.toast
  Scenario: A plugin shows a toast that the user dismisses
    Given the isolated plugin profile "@dshfiles/dialogs" is booted
    When a plugin shows a sticky toast "Draft saved"
    Then the toast "Draft saved" shows in the bottom-right corner
    When the user dismisses the toast
    Then no toast remains
