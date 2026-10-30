@platform-macos
Feature: Main view tabs

  Browser-like tabs above the main view follow whatever thread or global panel
  it shows. These journeys use a fresh isolated Host profile with no provider
  credentials. Workbench is not installed: the strip's native fallback is tested
  directly, with the real Plugins and Jujutsu main pages.

  @scenario:main-tabs.panels-and-threads
  Scenario: Panels and threads open as tabs that can be kept, pinned, reordered and closed
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And a disposable native-tabs workspace is selected
    And the Plugins and then Jujutsu are opened from the sidebar
    Then Jujutsu replaced the Plugins preview tab
    When the Jujutsu tab is kept, the Plugins page is opened again and a thread is started
    Then each of them has its own tab and the thread tab is active
    And the thread tab context menu copies its ID and clean link
    And that menu reports an unavailable side panel while no plugin offers one
    When the Plugins tab is pinned and the thread tab is dragged before Jujutsu
    Then the pinned tab leads and the thread tab moved
    When the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab
    Then only the pinned Plugins and the thread remain

  @scenario:main-tabs.strip-mount
  Scenario: The strip mounts right above whatever the main view shows
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And a disposable native-tabs workspace is selected
    And the Plugins page is opened as a tab
    Then the tab strip sits directly above the main panel, anchored before the main slot outlet
    When a thread is started beside the Plugins tab
    Then the tab strip still sits directly above the main panel

  @scenario:main-tabs.keyboard
  Scenario: Keyboard shortcuts jump between tabs
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And the Plugins and Jujutsu are opened and kept as tabs
    Then the tab shortcuts jump to the first and last tab and cycle between them

  @scenario:main-tabs.persistence
  Scenario: Tabs, pins and the active tab survive a reload
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And the Plugins and Jujutsu are opened and kept as tabs
    And the Plugins tab is pinned and the page is reloaded
    Then the tabs come back with the pin and the Jujutsu tab is active again
    When the saved tabs are corrupted and the page is reloaded
    Then the strip starts over from what the main view shows

  @smoke
  @scenario:main-tabs.native-look
  Scenario: The strip's tabs look like DSH's own right-panel tabs
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/editor, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And a disposable native-tabs workspace is selected
    And a thread is started and the right panel is opened beside it
    Then the active and inactive main tabs share the right panel tabs' metrics and colors

  @scenario:main-tabs.new-tab-page
  Scenario: "+" opens a Start page whose suggestions take its place
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And the Plugins page is kept as a tab and "+" is pressed
    Then a Start tab follows the Plugins with its search input focused and suggestions for a new thread, panels and Settings
    When Jujutsu is typed into the Start search and Enter picks it
    Then Jujutsu replaced the Start tab
    When a new tab is opened from the keyboard and Settings is picked
    Then Settings opens and the Start tab is gone

  @scenario:main-tabs.sidebar-thread-double-click
  Scenario: Double-clicking a sidebar thread keeps its preview tab
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable native-tabs workspace is selected
    And a thread is double-clicked in the sidebar before another is opened
    Then its tab stays open beside the next preview tab

  @scenario:main-tabs.thread-tab-side-panel
  Scenario: A thread tab's menu opens that thread in the side panel
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable native-tabs workspace is selected
    And a thread tab's context menu opens it in the side panel
    Then the side panel hosts that thread beside the main view

  @scenario:main-tabs.backlog-capture-with-thread-tab
  Scenario: Dropping a thread tab into Backlog inserts its mention without activating the tab
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/backlog, @dshfiles/input-trigger, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable native-tabs workspace is selected
    And a kept thread tab is present while text is typed into Backlog
    Then Backlog remains the active main tab after capture typing
    When backlog item b:1 is opened
    And the kept thread tab is dropped into its description and reply

  @scenario:main-tabs.move-tab-between-panels
  Scenario: A thread tab moves into the side panel and back to the main view
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable native-tabs workspace is selected
    And a second thread tab is dragged onto the side panel
    Then the side panel hosts that thread and its main tab is gone
    When the moved aside tab's menu moves that thread to the main area
    Then the thread is a main tab again and the side panel dropped its tab

  @scenario:main-tabs.mention-into-composer
  Scenario: Mentioning a thread into the composer from its tab menu and by dragging it there
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker" is booted
    When a disposable native-tabs workspace is selected
    And a thread tab is mentioned from its context menu
    Then its native mention chip joins the composer draft
    When the mentioned thread is dragged from its sidebar row into the composer
    Then a second mention chip joins the draft
    When the mentioned thread's tab is dragged into the composer
    Then a third mention chip joins the draft

  @scenario:main-tabs.move-panel-between-panels
  Scenario: A panel tab moves into the side panel and back to the main view
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/main-tabs, @dshfiles/jujutsu, @dshfiles/workspace-folder-picker" is booted
    When the standalone native tab strip is ready
    And a disposable native-tabs workspace is selected
    And the Jujutsu panel tab is dragged onto the side panel
    Then the side panel hosts Jujutsu and its main tab is gone
    When the moved aside Jujutsu tab's menu moves it to the main area
    Then Jujutsu is a main tab again and the side panel dropped its tab
