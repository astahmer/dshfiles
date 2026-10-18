  @scenario:workbench.global-dock
  Scenario: The global dock keeps one panel set outside any thread
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the right column is set to the global dock in the plugin settings
    Then the global dock shows the Jujutsu panel
    When a thread is started and the New Session screen opens again
    Then the global dock still shows the Jujutsu panel outside a thread
    When the global dock page is reloaded outside any thread
    Then the global dock still shows the Jujutsu panel after a reload
    When the Jujutsu panel is moved to the main view from the dock
    Then the main view shows the Jujutsu page and the dock no longer shows it
