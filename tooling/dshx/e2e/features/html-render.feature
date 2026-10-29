Feature: Agent-published HTML pages render as sandboxed cards

  A real html_render call from the fake model shows its page in the transcript
  as a sandboxed, themed iframe card that stays visible outside the completed
  Turn's fold and survives a reload. html_preview shows a workspace HTML file
  in the same card, with its relative stylesheet and script inlined.

  @scenario:html-render.card @scenario:html-render.preview-card
  Scenario: A published page renders isolated, expands and survives a reload
    Given the isolated plugin composition of "@dshfiles/html-render, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model publishes an isolation probe page with html_render
    Then the completed turn shows the page in a sandboxed card without network or parent access
    And the card opens in a new tab, still sandboxed
    And the card expands to full screen and is still there after a reload
    When the fake model shows a workspace HTML file with html_preview
    Then the preview card shows the file with its relative stylesheet and script inlined
