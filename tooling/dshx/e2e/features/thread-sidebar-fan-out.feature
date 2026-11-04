Feature: Thread sidebar model fan-out

  @scenario:thread-sidebar.multi-model-fan-out
  Scenario: Open the model fan-out dialog from the command palette
    Given the isolated plugin composition of "@dshfiles/thread-sidebar, @dshfiles/command-palette, @dshfiles/session-controller, @dshfiles/session-search" is booted
    When the command palette is opened
    When the palette query is "Send to several models"
    Then the fan-out command opens the model selection dialog
