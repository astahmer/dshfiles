Feature: Readable web fetch

  The readable fetch provider activates in a real Host and is listed as a
  running component. A real fetch is not journeyed: scratch Hosts have no
  external network (see the Host egress guard).

  @scenario:web-fetch-readable.activates
  Scenario: The readable fetch provider is installed and running
    Given the isolated plugin profile "@dshfiles/web-fetch-readable" is booted
    When the readable web fetch plugin is opened in the Plugins panel
    Then its fetch provider component is running

  @scenario:web-fetch-readable.citations
  Scenario: Web search and fetch results show source chips that open the page
    Given the isolated plugin composition of "@dshfiles/web-fetch-readable, @dshfiles/tool-meta, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a thread whose web search and fetch returned pages is opened
    Then each web result shows a source chip with its host and title
    When a source chip is clicked
