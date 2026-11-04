Feature: Whiteboard

  Boards are Excalidraw scenes the Host stores per project. The editor bundle
  loads only when a board opens; agents queue Mermaid the editor converts.

  @scenario:whiteboard.browser-journey
  Scenario: Draw on a project whiteboard, keep it across a reload, rename, delete and restore it
    Given the isolated whiteboard plugin profile is booted with a project
    When the Whiteboards page is opened
    And a whiteboard "Architecture" is created
    Then the Excalidraw editor is open on "Architecture"
    When a rectangle is drawn on the whiteboard
    Then the Host stores 1 element on whiteboard "Architecture"
    When the Whiteboards page is reloaded
    And whiteboard "Architecture" is opened
    Then the Excalidraw editor is open on "Architecture"
    And the whiteboard fits a 390 px phone screen
    When the board list is shown again
    And whiteboard "Architecture" is renamed to "System map"
    And whiteboard "System map" is deleted with confirmation
    Then "System map" is listed under Recently deleted
    When whiteboard "System map" is restored
    Then whiteboard "System map" is listed with 1 element
    And the Whiteboard journey has no browser errors

  @scenario:whiteboard.agent-mermaid
  Scenario: Open a board an agent drew in Mermaid and keep the converted shapes
    Given the isolated whiteboard plugin profile is booted with a project
    And an agent wrote whiteboard "Release flow" from Mermaid "flowchart LR\n  plan[Plan] --> build[Build] --> ship[Ship]"
    When the Whiteboards page is opened
    Then whiteboard "Release flow" shows "Mermaid queued"
    When whiteboard "Release flow" is opened
    Then the Host stores the converted Mermaid on whiteboard "Release flow"
    And the Whiteboard journey has no browser errors
