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
    When the Workbench tab is pinned and the thread tab is dragged before Jujutsu
    Then the pinned tab leads and the thread tab moved
    When the Jujutsu tab is closed with a middle click and other tabs are closed from the thread tab
    Then only the pinned Workbench and the thread remain

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
