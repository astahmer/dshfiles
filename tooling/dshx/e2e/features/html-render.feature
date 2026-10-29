Feature: Agent-published HTML pages render as sandboxed cards

  A real html_render call from the fake model shows its page in the transcript
  as a sandboxed, themed iframe card that stays visible outside the completed
  Turn's fold and survives a reload. html_preview shows a workspace HTML file
  in the same card, with its relative stylesheet and script inlined, and
  html_render_screenshot renders that page in the preview Host browser.

  @scenario:html-render.card @scenario:html-render.preview-card @scenario:html-render.screenshot @scenario:preview.render-html-journey
  Scenario: A published page renders isolated, expands and survives a reload
    Given the isolated plugin composition of "@dshfiles/html-render, @dshfiles/preview, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a Command Code account backed by a local fake provider is added
    And the fake model publishes an isolation probe page with html_render
    Then the completed turn shows the page in a sandboxed card without network or parent access
    And the card opens in a new tab, still sandboxed
    And the card expands to full screen and is still there after a reload
    When the fake model shows a workspace HTML file with html_preview
    Then the preview card shows the file with its relative stylesheet and script inlined
    When the fake model screenshots its latest page with html_render_screenshot
    Then the screenshot comes back as an image from the preview browser
