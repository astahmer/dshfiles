Feature: Workbench layouts

  Every pane hosts owned views in Dockview. A group's plus opens a real New tab
  chooser. Pane options manage splits and saved layouts without extra header rows.
  Each region keeps its saved layout; the full-height right pane stays live while hidden.

  @smoke
  @scenario:workbench.default-layout
  @scenario:workbench.persisted-layout
  Scenario: The default layout persists, resets and survives a corrupt save
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the Workbench is opened
    Then the default layout shows the Conversation
    When the main workbench adds the registered "Editor" panel
    And the Editor panel is closed and the page is reloaded
    Then the closed panel stays closed and can be added back
    When the saved Workbench layout is corrupted and the page is reloaded
    Then the Workbench falls back to its default layout

  @scenario:workbench.missing-plugin
  Scenario: A panel whose plugin is disabled waits as a placeholder
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the Workbench is opened
    And the main workbench adds the registered "Editor" panel
    And the Editor tab is selected and the editor plugin is disabled
    Then the Editor tab stays as a closable placeholder
    When the editor plugin is enabled again
    Then the Editor tab shows the editor again

  @scenario:workbench.surface-layouts
  Scenario: The right pane keeps a layout apart from the main Workbench
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/editor, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And the main workbench adds the registered "Editor" panel
    And the right pane closes its Jujutsu panel
    Then the main Workbench keeps its own layout

  @scenario:workbench.global-dock
  @scenario:frame-layout.global-dock
  Scenario: The global dock keeps one panel set outside any thread
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor, @dshfiles/workspace-folder-picker" is booted
    When the unified Workbench is ready
    And the right pane is opened from the main Pane options
    Then the global dock shows the Jujutsu panel
    When a thread is started and the New Session screen opens again
    Then the global dock still shows the Jujutsu panel outside a thread
    When the global dock page is reloaded outside any thread
    Then the global dock still shows the Jujutsu panel after a reload
    When the Jujutsu panel is moved to the main view from the dock
    Then the main view shows the Jujutsu page and the dock no longer shows it
    When the right pane is closed with its own Close pane control

  @scenario:workbench.bottom-panel
  @scenario:frame-layout.bottom-panel
  Scenario: A panel moves from the right column into the bottom panel
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the right pane is opened from the main Pane options
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from Pane options
    Then the bottom panel is open below the columns
    When the Jujutsu panel is moved to the bottom panel
    Then the bottom panel shows the Jujutsu panel and the dock no longer does
    When the bottom panel is hidden again from Pane options

  @scenario:workbench.drag-between-regions
  Scenario: A panel dragged by its tab lands in another region
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the right pane is opened from the main Pane options
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from Pane options
    Then the bottom panel is open below the columns
    And the bottom row starts with its own chooser tab
    When the Jujutsu tab is dragged from the dock into the bottom panel
    Then the bottom row took the dragged Jujutsu panel and the dock lost it
    When the Jujutsu tab is dragged from the bottom panel back into the dock
    Then the dock took the dragged Jujutsu panel back and the bottom row lost it
    When the bottom panel is hidden again from Pane options

  @scenario:workbench.saved-layouts
  Scenario: A named layout brings a panel back to where it was saved
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the right pane is opened from the main Pane options
    Then the global dock shows the Jujutsu panel
    When the bottom panel is shown from Pane options
    Then the bottom panel is open below the columns
    And the Jujutsu panel is moved to the bottom panel
    And the current layout is saved as "bottom jujutsu"
    And the Jujutsu panel is moved back to the right column
    Then the dock shows the Jujutsu panel and the bottom panel does not
    When the "bottom jujutsu" layout is applied
    Then the bottom panel shows the Jujutsu panel and the dock no longer does
    When the bottom panel is hidden again from Pane options
    And the right pane is closed with its own Close pane control

  @platform-macos
  @scenario:workbench.early-open
  Scenario: Go to file opens its requested file in the unified Workbench
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/editor, @dshfiles/workspace-folder-picker, @dshfiles/command-palette" is booted
    When the unified Workbench is ready
    And a disposable workspace with source, dependency and version-control files has a thread
    And "hello.ts" is opened with Go to file
    Then "hello.ts" opens in the "workbench" editor with its disk content

  @scenario:workbench.main-hosts-the-conversation
  Scenario: The main workbench hosts real conversations and switches their threads
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    Then the conversation is inside a Dockview panel and switching threads changes its messages
    And the workbench main acceptance journey is complete

  @scenario:workbench.legacy-disabled-conversation-tabs
  @scenario:main-tabs.workbench-legacy-disabled-conversation-tabs
  Scenario: Legacy disabled preview preferences still keep two sidebar conversations through reload
    Given an isolated Workbench profile with legacy disabled preview tabs is booted
    Then Main tabs settings still show disabled tabs and Preview opening
    When two real Workbench threads are opened normally from the sidebar
    Then both sidebar conversations have their own kept fixed-session tabs
    When each fixed-session conversation receives its own draft
    Then switching conversation tabs preserves distinct messages and drafts
    When the Workbench main page is reloaded
    Then both sidebar conversations have their own kept fixed-session tabs
    And switching conversation tabs preserves distinct messages and drafts
    When the first fixed-session conversation tab is closed
    Then the second fixed-session conversation keeps its messages and draft
    And the workbench main acceptance journey is complete

  @scenario:workbench.add-a-main-panel
  @scenario:settings-shell.workbench-panels
  @scenario:thread-sidebar.workbench-assemblies
  Scenario: The New tab chooser hosts registered pages and one real Settings hub
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu, @dshfiles/settings-shell, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And the main workbench adds the registered "Jujutsu" panel
    And the main workbench adds the registered "Settings" panel
    Then the registered main page and original General controls are docked in the Settings hub
    When the Settings hub is closed from its Dockview tab
    Then the Jujutsu panel remains and only the Settings hub is offered in the chooser
    When the four owned sidebar assemblies are opened from New tab
    Then Threads Sidebar status Sidebar actions and Navigation use their real owned seats
    And the workbench main acceptance journey is complete

  @scenario:workbench.drag-across-all-regions
  Scenario: Real pointer drags move one panel through centre right and bottom and reload restores it
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And the main workbench adds the registered "Jujutsu" panel
    And the main workbench opens an empty dock and bottom row
    And the main Jujutsu tab is dragged into the right dock
    Then only the right dock holds the Jujutsu panel
    When the dock Jujutsu tab is dragged into the bottom row
    Then only the bottom row holds the Jujutsu panel
    When the Workbench main page is reloaded
    Then only the bottom row holds the Jujutsu panel
    When the bottom Jujutsu tab is dragged into the centre
    Then only the centre holds the Jujutsu panel
    And the workbench main acceptance journey is complete

  @platform-macos
  @scenario:workbench.tab-semantics
  @scenario:main-tabs.workbench-tab-semantics
  Scenario: Dockview conversations stay kept and preserve pin unread close and thread-open semantics
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    Then the latest Dockview thread tab is kept by default and the old main strip is absent
    When the Dockview thread tab is pinned from its context menu
    Then the Dockview thread tab is kept and pinned
    When the pinned Workbench thread is moved aside from its real tab menu
    Then the right dock alone holds the same pinned Workbench thread
    When the pinned Workbench thread is dragged from the right dock back into the centre
    Then the centre alone holds that same pinned Workbench thread
    When the Workbench New tab control is clicked
    Then a focused New tab chooser offers reusable views without changing the pinned thread
    When the semantic chooser is closed and both conversations are opened from the sidebar
    Then both fixed Workbench threads remain unique and the second stays pinned
    When the native New tab shortcut opens the same chooser
    Then closing the semantic chooser preserves both fixed threads and the pin
    When the first Workbench thread is marked unread from its sidebar row
    Then its Dockview tab shows an unread indicator that clears when opened
    When a Jujutsu preview is opened and closed from its Dockview tab
    Then the pinned thread remains open and its conversation can still receive a draft
    And the workbench main acceptance journey is complete

  @scenario:workbench.slots-stay-compatible
  @scenario:sidebar-right.workbench-resources
  @scenario:session-controller.live-model-catalog
  Scenario: Real native preview review and terminal resources become panels without losing their owners
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/thread-sidebar, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/session-controller, @dshfiles/model-selection, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/ai-accounts, @dshfiles/workspace-folder-picker, @dshfiles/command-palette" is booted
    When a Command Code account backed by a local fake provider is added
    And a disposable Workbench resource thread edits two real files
    And the unified Workbench is ready
    And the Workbench thread opens a real file link and its turn review
    And the Workbench command palette opens a new native terminal
    Then file preview diff review and terminal each have a native owned Workbench panel
    When the Workbench main page is reloaded
    Then the native resource panels restore with their real contents
    And the workbench main acceptance journey is complete

  @scenario:workbench.nested-surfaces
  Scenario: Real split groups merge by drag and restore their saved arrangement without nested containers
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/jujutsu, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the main pane is split right beside Editor through Pane options
    Then Editor and Jujutsu occupy real adjacent groups without a nested container
    When the current layout is saved as "side by side"
    And the split Jujutsu tab is dragged into the Editor group
    Then the two panels share one group with their original identities
    When Jujutsu is split down through its group Pane options
    And the Workbench main page is reloaded
    Then the downward split restores both original panels after reload
    When the "side by side" layout is applied
    Then Editor and Jujutsu occupy real adjacent groups without a nested container
    And the workbench main acceptance journey is complete

  @scenario:workbench.default-main-surface
  @scenario:workbench.unified-surfaces
  Scenario: Saved native preferences migrate to the unified owned Workbench
    Given an isolated Workbench profile with saved legacy native preferences is booted
    Then the default centre is the dockable Workbench
    And no native surface choice is exposed in Workbench settings
    When the unified right pane is revealed from the main Pane options
    And the Workbench main page is reloaded
    Then the default centre is the dockable Workbench
    And the migrated right pane visibility survives the reload
    And the workbench main acceptance journey is complete

  @platform-macos
  @scenario:workbench.right-pane-toggle
  Scenario: The original right toggle keeps a full-height live view while the bottom is open
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the original right sidebar shortcut opens the Workbench pane
    Then the right Workbench pane fills the frame height
    When a disposable Workbench workspace has two real threads
    And each fixed-session conversation receives its own draft
    And the bottom panel is shown from the main Pane options
    And the second fixed conversation is moved into the right pane
    Then sidebar switching keeps the right conversation fixed while the bottom stays independent
    When a Scratchpad view in the right pane receives a draft
    Then the right Workbench pane stays full height and the bottom ends at its left edge
    When the right pane is closed with its own Close pane control
    Then the same right pane draft remains mounted while hidden
    When the original right sidebar shortcut opens the Workbench pane
    Then the same right pane view and draft are restored without remounting
    And the workbench main acceptance journey is complete

  @scenario:workbench.responsive-main
  Scenario: Main surface controls stay reachable at narrow widths and in a split layout
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/jujutsu, @dshfiles/editor, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And the main workbench adds the registered "Jujutsu" panel
    Then the quiet pane tab strips fit at 360 480 768 and 1024 pixels
    When the main workbench adds the registered "Editor" panel
    And the main Editor tab is dragged to split beside Jujutsu
    Then both split groups and their tab strip actions remain reachable
    And the workbench main acceptance journey is complete

  @scenario:workbench.every-pane-views
  Scenario: The custom Threads plugin view can replace content in every pane
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And the main workbench opens an empty dock and bottom row
    And the real Threads view is opened through every pane chooser
    And a plugin view is moved into the collapsed left pane
    Then the left pane reveals the explicitly moved plugin view
    When Reset layout is used from a remaining Workbench surface
    Then the left pane content is tab controlled between fixed chrome
    And the workbench main acceptance journey is complete

  @scenario:workbench.layout-recovery
  Scenario: Reset recovers moved chat tabs and stays recovered after reload
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/main-tabs, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts, @dshfiles/jujutsu" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And the Dockview thread tab is pinned from its context menu
    And the pinned Workbench thread is moved aside from its real tab menu
    Then the right dock alone holds the same pinned Workbench thread
    When the current layout is saved as "chat moved aside"
    And the "chat moved aside" layout is applied
    And Reset layout is used from a remaining Workbench surface
    Then the main chat tab and composer are recovered without losing its pin
    When Reset layout is used from a remaining Workbench surface
    And the Workbench main page is reloaded
    Then the main chat tab and composer are recovered without losing its pin
    And the left pane content is tab controlled between fixed chrome
    And the workbench main acceptance journey is complete

  @scenario:rich-composer.workbench-conversation-views
  @scenario:workbench.reusable-view-picker
  Scenario: New tab choosers offer reusable plugin views rather than individual chat trajectories
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    Then the reusable view picker offers plugins without per-thread trajectories
    And the left pane content is tab controlled between fixed chrome
    When the Workbench main page is reloaded
    Then the reusable view picker offers plugins without per-thread trajectories
    And the workbench main acceptance journey is complete

  @scenario:workbench.new-tab-chooser
  Scenario: Every group plus opens a searchable chooser tab and selecting a view replaces only that tab
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/settings-shell, @dshfiles/backlog, @dshfiles/main-tabs, @dshfiles/editor, @dshfiles/thread-sidebar, @dshfiles/workspace-folder-picker, @dshfiles/session-controller, @dshfiles/rich-composer, @dshfiles/chat, @dshfiles/multi-host, @dshfiles/jj-integration, @dshfiles/ai-accounts" is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And the main workbench opens an empty dock and bottom row
    And each empty auxiliary pane presents its own New tab chooser
    And the main pane gains another chooser group with Split right
    Then every group plus opens a real searchable New tab instead of a menu
    And choosing Editor replaces only its chooser tab and preserves the other panes
    When a real Backlog tab is saved inactive beside the current conversation
    And the Workbench main page is reloaded
    Then the conversation and saved Backlog tab restore without losing their plugin owners
    And the workbench main acceptance journey is complete

  @scenario:workbench.quiet-pane-chrome
  Scenario: Pane actions share the tab strip without duplicated headings or toolbars
    Given the isolated plugin composition of "@dshfiles/frame-layout, @dshfiles/sidebar-right, @dshfiles/workbench, @dshfiles/editor" is booted
    When the unified Workbench is ready
    And the main workbench opens an empty dock and bottom row
    Then pane chrome has one tab strip with local actions and no duplicate toolbar
    When the bottom pane is closed with its local Close pane control
    And the right pane is closed with its own Close pane control
    Then the main Pane options offers opening but never closing the right pane
    And the workbench main acceptance journey is complete

  @scenario:workbench.last-root-safety
  Scenario: Floating the last centre tab keeps a docked chooser and its draft
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified Workbench is ready
    And a drafted Scratchpad is the only tab in the centre grid
    And the final centre Scratchpad tab is floated with the real Shift gesture
    Then the last centre grid cannot close into its floating neighbour
    When the last centre chooser tab is closed twice
    Then the centre chooser and the same floating draft remain reachable
    And the workbench main acceptance journey is complete

  @platform-macos
  @scenario:workbench.reset-visible-current-chat
  Scenario: Reset reveals the current chat and left thread list from tools and legacy floats
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And each fixed-session conversation receives its own draft
    And the Dockview thread tab is pinned from its context menu
    And the pinned Workbench thread is moved aside from its real tab menu
    And a tool is active while the left thread list is collapsed
    And Reset layout is used from a remaining Workbench surface
    Then Reset visibly restores the left thread list and current chat with history drafts and pin
    When Reset layout is used from a remaining Workbench surface
    Then Reset visibly restores the left thread list and current chat with history drafts and pin
    When the Workbench main page is reloaded
    Then Reset visibly restores the left thread list and current chat with history drafts and pin
    When a legacy all-floating main layout with collapsed left is restored
    And the global command palette resets the Workbench without a pane menu
    Then Reset visibly restores the left thread list and current chat with history drafts and pin
    When the Workbench main page is reloaded
    Then Reset visibly restores the left thread list and current chat with history drafts and pin
    When the recovered sidebar is dragged to its maximum wide width
    Then global Reset keeps both chat and thread list visible at narrow widths
    And widening restores the dragged sidebar width without losing chat state
    And the workbench main acceptance journey is complete

  @scenario:workbench.fixed-conversation-lifecycle
  Scenario: Sidebar conversations reopen with complete fixed inputs and legacy followers never return
    Given an isolated Workbench recovery profile with Main Tabs and demo views is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And each fixed-session conversation receives its own draft
    Then ordinary sidebar opens focus fixed tabs and close-all reopens their complete inputs
    And the New tab chooser never offers a global current conversation
    When legacy global conversation aliases are restored beside the fixed tabs
    Then reload and Reset keep only complete fixed-session conversations
    And the workbench main acceptance journey is complete

  @scenario:workbench.plugin-view-names
  Scenario: Reusable plugin views are qualified and legacy saved titles refresh without losing owners or drafts
    Given an isolated Workbench view-name profile with Main Tabs and demo views is booted
    When the unified Workbench is ready
    And a disposable Workbench workspace has two real threads
    And each fixed-session conversation receives its own draft
    Then the view chooser exposes qualified plugin names and AI Accounts search selects its Preview
    When legacy reusable view titles are saved with their original panel IDs and restored
    Then restored reusable views have qualified titles with the same IDs and one live mount
    And switching conversation tabs preserves distinct messages and drafts
    When the restored Scratchpad receives a draft and its pane is hidden and reopened
    Then the qualified Scratchpad keeps its same draft DOM and mount count
    And the workbench main acceptance journey is complete
