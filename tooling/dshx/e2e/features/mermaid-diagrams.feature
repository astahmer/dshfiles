Feature: Mermaid fences render as diagrams in the conversation

  The fake model answers with Markdown that holds a ```mermaid fence. Chat hands the
  settled fence to the mermaid-diagrams renderer, which imports pele from the Host
  route and draws the diagram; a fence pele cannot parse shows its error above the
  highlighted source.

  @scenario:mermaid-diagrams.chat-diagram
  Scenario: A settled mermaid fence renders as a diagram with its source a click away
    Given the isolated plugin composition of "@dshfiles/mermaid-diagrams, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model answers with a mermaid flowchart
    Then the answer shows the flowchart as a diagram drawn by the renderer the Host serves
    And Show code shows its source and Show diagram brings the diagram back
    And the diagram expands full size and closes
    When the fake model answers with a mermaid fence it cannot parse
    Then the card shows the parse error above the source
