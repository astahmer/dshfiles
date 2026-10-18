Feature: Main view tabs

  Browser-like tabs above the main view follow whatever thread or global panel
  it shows. These journeys use a fresh isolated Host profile with no provider
  credentials and the native sidebar.

  @scenario:main-tabs.panels-and-threads
  Scenario: Panels and threads open as tabs that can be kept, pinned, reordered and closed
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the Workbench and then Jujutsu are opened from the sidebar
    Then Jujutsu replaced the Workbench preview tab
    When the Jujutsu tab is kept, the Workbench is opened again and a thread is started
    Then each of them has its own tab and the thread tab is active
    And the thread tab context menu copies its ID and clean link
    And that menu reports an unavailable side panel while no plugin offers one
    When the Workbench tab is pinned and the thread tab is dragged before Jujutsu
    Then the pinned tab leads and the thread tab moved
    When the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab
    Then only the pinned Workbench and the thread remain

  @scenario:main-tabs.strip-mount
  Scenario: The strip mounts right above whatever the main view shows
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the Workbench is opened as a tab
    Then the tab strip sits directly above the main panel, anchored before the main slot outlet
    When a thread is started beside the Workbench tab
    Then the tab strip still sits directly above the main panel

  @scenario:main-tabs.keyboard
  Scenario: Keyboard shortcuts jump between tabs
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the Workbench and Jujutsu are opened and kept as tabs
    Then the tab shortcuts jump to the first and last tab and cycle between them

  @scenario:main-tabs.persistence
  Scenario: Tabs, pins and the active tab survive a reload
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the Workbench and Jujutsu are opened and kept as tabs
    And the Workbench tab is pinned and the page is reloaded
    Then the tabs come back with the pin and the Jujutsu tab is active again
    When the saved tabs are corrupted and the page is reloaded
    Then the strip starts over from what the main view shows

  @smoke
  @scenario:main-tabs.native-look
  Scenario: The strip's tabs look like DSH's own right-panel tabs
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When a thread is started and the right panel is opened beside it
    Then the active and inactive main tabs share the right panel tabs' metrics and colors

  @scenario:main-tabs.new-tab-page
  Scenario: "+" opens a Start page whose suggestions take its place
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the Workbench is kept as a tab and "+" is pressed
    Then a Start tab follows the Workbench and suggests a new thread, the panels and Settings
    When the arrow keys move to Jujutsu and Enter picks it
    Then Jujutsu replaced the Start tab
    When a new tab is opened from the keyboard and Settings is picked
    Then Settings opens and the Start tab is gone

  @scenario:main-tabs.sidebar-thread-double-click
  Scenario: Double-clicking a sidebar thread keeps its preview tab
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/thread-sidebar" is booted
    When a thread is double-clicked in the sidebar before another is opened
    Then its tab stays open beside the next preview tab

  @scenario:main-tabs.thread-tab-side-panel
  Scenario: A thread tab's menu opens that thread in the side panel
    Given the isolated plugin composition of "@dshfiles/main-tabs, @dshfiles/thread-sidebar" is booted
    When a thread tab's context menu opens it in the side panel
    Then the side panel hosts that thread beside the main view
