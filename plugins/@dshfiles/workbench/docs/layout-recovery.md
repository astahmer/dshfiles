# Pane views and layout recovery

## Contract

Extend the existing owned Workbench registry rather than patching DSH core or adding a second pane system. A plugin exports a reusable `WorkbenchPanelDefinition` through `@dshfiles/workbench/registry`. All root panes (left, centre, right and bottom) and nested groups accept that renderer. Explicit independent scopes remain the contributor's responsibility; choosing an existing unscoped view adopts its occurrence instead of duplicating its owner.

The sidebar declares `shell.left` for its middle content. Its authorized Threads and Navigation assemblies are regular views. Brand/history/palette controls and native account/footer chrome remain outside. The Threads panel owns its Sidebar settings wheel and the original customization editor's React portal seat, so neither is fixed app chrome. An explicit move into a collapsed left pane reveals the destination; passive restoration does not toggle it.

Every Dockview group's **+**, accessible as **New tab**, opens an actual **New tab** chooser tab immediately after its tabs. The **Choose a view** region contains **Search views**, one **Settings Shell: Settings** hub and plugin views. Conversations open from the thread list or **New thread**, never a separate Rich Composer/current-conversation picker source. Existing unscoped plugin views move their occurrence. Settings uses its real navigation and forms; leaf sections are not primary suggestions. Empty right/bottom panes and semantic Start tabs use the same chooser. Per-session Trajectories, resource instances and nested-container instances are not templates; saved instances still restore.

There is no Workbench heading, persistent toolbar, duplicate Add panel dropdown or pane-preference checkbox/up/down strip. Each group's far-right **Pane options** menu provides **Split right**, **Split down**, **Layouts**, **Move tab to**, **Reset layout** and bottom-pane toggling. Splits create actual Dockview groups, never new nested containers. Existing nested layouts remain readable. The main group's menu alone offers **Open right pane**, only while closed; right/bottom panes close through their own far-right **Close pane** icons, not a centre Close right pane action.

## Plugin-qualified names

Reusable templates are named **Plugin: View** by their producers: explicit registry definitions supply the title, and supported `sidebar.panellist` list labels supply main-view names. Native keyed `main` options do not support labels, so no invented SDK field is added. Stock Plugin Manager and Schedule templates have a bounded installed-runtime compatibility prefix; unknown plugin owners are never guessed from package IDs or registrant diagnostics.

Footer list entries declare their own labels. The authorized Thread Sidebar adapter keeps its existing aggregate views and stable IDs, using the exact qualified preview label when there is one contributor. A common declared display prefix can group controls; mixed or unlabelled contributors retain a truthful **Thread Sidebar: Plugin controls/previews** caption. This is display metadata, not security provenance. Foreign components still render through the declarer's delegated slot renderer.

Caption changes refresh existing reusable panels and their saved names without replacing IDs or remounting content. Semantic panel tabs project the canonical template caption; conversation titles, scoped subjects and resource/file instances remain authoritative. No layout reset or storage-key migration is required.

The [chooser capture](evidence/view-names-chooser.png) and [restored Preview/Scratchpad capture](evidence/view-names-restored.png) come from the naming regression against stock core. The test keeps old source IDs, edits only legacy saved captions, reloads, and verifies qualified names plus separate conversation drafts and retained component state. Its demo fixtures and synthetic thread turns are not a claim that an external AI provider answered.

Verification: 146 Workbench unit tests, 12 focused Sidebar assembly tests, 117 Main Tabs unit tests, 32 scratch-verifier tests and all 22 changed-plugin typechecks pass. The 24 Workbench journeys and 12 native Main Tabs journeys pass across focused batches; the available producer smoke tags add two passing cases. A scratch composition with all changed view providers passes doctor and the catalog chooser walk with zero console/page/network/HTTP errors. Broader untagged producer workflows are not re-run for presentation-copy changes. The native-fork inventory still reports existing added Chat/Rich Composer files; none of the vendored native paths changes here. Scoped lint has no new findings; unrelated existing verifier errors/warnings remain.

## Unified surface ownership

The centre always uses the owned Dockview surface, even when an old profile saved `mainSurface: native`. That field, `rightPanel` and `headerToggle` remain hidden decode-only inputs, not UI modes. The old right-panel value seeds browser-local visibility once. The main Pane options opener, original conversation-header opener, right-pane Close pane icon, move-aside command and original sidebar shortcut share the registered `DockPaneActions` contract.

The right dock stays mounted while closed and spans both frame rows. The bottom pane ends at its left edge. Native resource Session providers remain in an authorized hidden carrier; only their actual addressable view bodies are portalled into Dockview. Explicit resource opens reveal the pane; passive restore does not. This retains real resource cleanup and terminal lifetime without exposing the old native chrome.

### Last right tab

Closing the last remaining right tab closes that pane through the existing `DockPaneActions.close`, including closing its last **New tab** chooser. The old generic empty repair immediately created another chooser and therefore kept the column open. Right-region passive repair no longer does that; main/left/bottom policies are unchanged.

A native `onDidMutateLayout` positive-to-zero transition decides after the whole operation, counting all API panels, including floats. It ignores load/clear restoration rather than closing during a transient split/move or empty setup. The retained API, layout store and resource owner stay in place. Manual visibility reopening supplies one chooser only if still empty; an explicit resource admission may already have populated it. No reset, handoff replay or second visibility store is involved. Reload respects the closed pane. The permanent main grid still supplies a chooser when empty.

Verified by 244 Workbench unit tests and strict types, plus six real-browser cases covering partial/final tab close, last chooser close, manual reopen, closed reload, direct view admission, actual native preview/review/terminal resources, retained right-pane drafts/geometry, source-right floating and permanent-centre safety. The targeted browser command is `node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts --workers=1 --grep '@scenario:workbench.(last-right-tab-close|right-pane-toggle|slots-stay-compatible|floating-source-offset|last-root-safety|sidebar-preview-tab)'` from `tooling/dshx` with the official-core/Chromium scratch environment. A named scratch doctor/close-and-reopen catalog walk/shot/down also passes with zero console, page, request and HTTP errors (one non-error warning). Palette-based reaches explicitly include the command-palette provider; its launcher/API alone does not activate that overlay. The live GUI is not refreshed or restarted.

## Content-only single-tab groups

The existing group stays docked and mounted; only its tab row is hidden.

```text
single + shown --Hide tab row--> single + hidden
single + hidden --Show tab row / palette--> single + shown
single + hidden --add/drop second tab--> multiple + shown
multiple + shown --close down to one--> single + shown
```

Right-click the sole tab or blank row space. **Hide tab row** is disabled with multiple members. The content's top-right **Show tab row** control appears on hover or keyboard focus; **Workbench: Show tab rows** in the global palette also recovers every mounted region, including nested ones. Content/editor context menus are not intercepted. A stable singleton restores hidden after reload. If a genuine new tab arrives during startup, the same second-member rule correctly reveals it.

Installed Dockview React 8.4.1/core 8.5.1 exposes `group.header.hidden` and `group.relayout()`, and persists native `hideHeader` in existing layout JSON. The flag setter emits no persistence event, so explicit hide/show saves directly. `TabRows` observes group-model add/remove events before restoration; top-level API add events are suppressed during native moving locks. It reveals synchronously at the second member but never serializes a half-finished move. Native completed-layout persistence remains authoritative. The observer only owns subscriptions/version notifications, not a second preference store or tab actor. The native edge-shell variant lacks restoration support and is excluded; owned Workbenches use ordinary grid groups. Main grid safety keeps a docked view reachable without forcibly unhiding an intentional singleton.

The former fixed account Preview uses the existing authorized status assembly as a regular bottom-left group. The producer checks the supported `shell.left` entries/subscription and retains its fixed fallback only for standalone Sidebar. A once-only browser marker seats the old footer without resetting other groups, respects every existing root/nested placement and prevents resurrection after explicit close. It does not own placement: native layout JSON does. **Reset layout** deliberately restores the default. Actual account controls, native brand/account toolbar and update notices keep their original owners.

Verification: 235 Workbench units and strict types, 21 focused Sidebar ownership tests and 39 existing quota-action tests pass. Three real-browser journeys prove tab/blank-row hide, original editor/DOM/mount continuity, content hover and global recovery, genuine cross-region tab drop/reveal, nonsticky return to one, singleton reload, startup-tab reveal, movable/closeable/reopenable Preview and legacy-layout conversion/reset without duplication. No real provider credentials or billing claims are involved. The demo Scratchpad intentionally owns page-local text; its text is not claimed to survive page reload.

The 38-case regression batch exposed two old fixture assumptions: a terminal selected the last left group (now the compact Preview instead of Threads), and three shared checks still expected only two left groups. The repair selects the actual Threads group and explicitly asserts the regular Preview plus all three row controls; no shell/PID, cleanup, fixed-chrome or view-ownership assertions are removed. The genuine four-shell lifecycle and the three affected view/reset/picker cases recheck green separately (1/1 and 3/3); the three new content-only/Preview cases also pass 3/3. The existing aggregate evidence-retention failure is tracked independently and is not presented as a green batch command.

Focused commands (with the official-core/Chromium scratch environment from `verify-dsh`):

```sh
# From tooling/dshx, with the changed bundles already built:
node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts --workers=1 --grep '@scenario:workbench.single-tab-row|@scenario:workbench.sidebar-preview'
# From plugins/@dshfiles/workbench:
node node_modules/vitest/vitest.mjs run --reporter=dot
node node_modules/typescript/bin/tsc -p tsconfig.json --noEmit
```

The named scratch CLI doctor, Sidebar assembly reach, hide/show reach and account Preview reach all pass, followed by shot/down; console/page/request/HTTP errors and warnings are zero. The live GUI is not refreshed or restarted by verification.

## Root-pane floating windows

**Float panel** in a tab context menu, and native Shift-float, keep the same pane API, panel object, renderer and draft. The window can move across the application rather than being bounded by its source pane. Drag the top floating titlebar to move it; drag the actual tab onto another pane to dock through the existing cross-region owner. The latter preserves occurrence identity, not a promise that a contributor's React instance survives a cross-API adopt. Ordinary float movement/resizing keeps the exact live body and editor mounted.

In installed Dockview React 8.4.1/core 8.5.1, a floating overlay's viewport is its local Dockview host. The real Threads reproduction stops at x179 in a279px left pane because the default retains100px inside that source. `boundedWithinViewport` alone is stricter, not a fix; there is no public unbounded/portal option. Merely unclipping overflow or moving the private chrome DOM does not handle the separate always-rendered body. No DSH core/library patch, fake method, DOM reparent or second resource registry is added.

The four explicit root regions supply owned shell-origin CSS variables before native restore. Their immediate native overlay host stays **absolute**, viewport-sized and negatively origin-offset, so native move/resize bounds see the window. Each actual floating chrome and persistent floating body uses fixed positioning; body margins compensate native shell-relative coordinates. Keeping the host absolute avoids a stacking context that would let an older body cover a newer titlebar. Other native transforms and each registered panel's layout/paint containment remain unchanged. Event-coalesced measurement refreshes public `api.layout` with the source's own dimensions, even on a width-only window resize that leaves that pane's size unchanged. It does not grow the docked grid to window dimensions, poll or scan the document, and descendant chat scroll does not trigger root measurements.

Native module-global aria ordering still raises only on a **local** inactive-to-active group transition. Separate pane APIs can both remain locally active; a real exposed older titlebar/body click then does not raise its window over the other API. A document-local, presentation-only window ordering owner fixes this without synthesizing native focus, toggling group activity or recreating chrome. It derives each actual window and split-group body members from public groups/panels plus owned panel markers. Real pointer/focus intent promotes only that window, not every float from its source. Compact live-window ranks are applied through owned data/CSS properties; native aria-level, inline z-index, activity and serialization stay untouched. Add/remove/unfloat/member-close/root-disposal reconcile and remove only owned marks and subscriptions. There is no second resource or saved-selection owner.

Nested surfaces remain native/local because their containing panel intentionally supplies a paint boundary. Hiding or responsively collapsing a source pane retains native descendant visibility behavior; its float returns when the pane returns. Existing local-coordinate floating placements may shift once into window coordinates; native bounds keep them reachable without a layout reset or resource loss. New placements round-trip through the existing native layout store.

The [Threads capture](screenshots/window-floating.png) is the real sidebar renderer moved over the main area, not a recreated mock. The browser checks actual content hit testing outside the source, exact body DOM continuity, reload/width-only clamp, tab redock/main reload, a real Scratchpad draft/mount and geometrically overlapping titlebar versus older body, then alternate older/newer exposed titlebar clicks with actual hit testing across APIs, and right-pane origin movement. The focused native/React suite also covers all root/nested admissions, initialization, unchanged-style suppression, hidden/disposal cleanup and scroll filtering. Source-window geometry is presentation-only; native Session, input, terminal and resource owners are unchanged.

Verified: 219 Workbench unit tests, strict types and the 8 current floating/tab/nested/right-toggle/last-centre/reset browser cases pass, including the older/newer window focus alternation. The preceding geometry-wide batch completes all 35 product cases successfully; its command exits unsuccessfully only because the existing evidence reporter cannot retain that aggregate run. That separate tooling retention issue is not presented as a green command or hidden by weakening assertions. The named scratch CLI up/doctor/window-floating reach/shot/down path is green with zero console/page/request/HTTP errors. The live GUI is not refreshed or restarted by these checks.

## Stable window scene across project navigation

A selected Session's project is subject metadata, not authority to switch the Workbench scene. Main Tabs derives a window-scope policy that holds the already-adopted set key. Existing project/global sets and saved arrangements stay intact; no merge, forced global preference or reset is required. Normal native fallback still follows projects. A project filter only changes thread-list results, not open-tab topology.

The reported window has an ordinary NewView chooser, conversation B and conversation A. A's cached scene has all three; B's older scene has only the conversations in a different order. Previously selecting B changed the semantic scope on the genuine Host ACK, and restoring that entire cached scene removed the chooser without a close gesture. The fixed producer holds the scene while publishing B's actual Session/project and selection. The consumer preserves the exact chooser and conversation occurrences, order, pins and draft owners.

On initial hydration, the live region layout stores are authoritative. A per-scope snapshot is a scene-switch cache, not a newer copy of the current window: restoring it on startup can resurrect a chooser explicitly closed after the last scope switch. Cached scenes restore only on a subsequent actual scope change, such as an explicit persistence preference change. Named layout commands remain deliberate full-scene operations.

The [cross-project capture](evidence/cross-project-chooser.png) retains the same three tabs after selecting B. The fixture intentionally has no external model credentials; its settled failure is not a claim of successful model generation.

The cross-project browser regression uses two real native workspace-attached Sessions and legacy versioned persisted scenes, then exercises actual header clicks, repeated switches, reload, explicit chooser close and another reload. It does not fake project events, app context or rendered DOM. Real-actor Main Tabs tests protect producer scope/ACK behavior; real Dockview consumer tests protect occurrence identity and cache admission through the existing public snapshot seam. No additional Host API or execution layer is introduced.

## One complete conversation owner

A conversation tab is fixed to one Session and includes the native chat **and** InputBar. The thread list emits explicit open/focus intent to the tab actor before falling back to native navigation, so reopening the same native-current Session works after every visible tab was closed. Existing tabs deduplicate by Session identity; normal Workbench conversation opens stay kept rather than replacing a preview. A single-current-following-tab preference is deliberately not introduced.

Only the not-yet-materialized New thread/workspace picker uses the native draft fallback. Every materialized Session, including a blank draft, belongs to a fixed semantic tab. Removing that tab is not a request to resurrect a native fallback, regardless of the Session's blank flag. Global `conversation`, `current-conversation`, source-parameter clone occurrences and old `main/conversation` aliases retire during reconciliation; they are not picker choices and cannot mount a second editor for an established fixed tab. Named/scope layout restoration reconciles through the same owner.

Main Tabs and the thread sidebar follow the exact public `uiSession.adapter.current` key and observe that source directly. The sidebar's selected row, route-readiness guard and URL writeback use the same selected identity rather than reverting to a different retained Session. A first-retained-by-main heuristic cannot distinguish two overlapping references and can choose the wrong Session/project; authoritative absence does not fall back to an old retained record. Fixed views keep their own references regardless of that global navigation.

Fresh [fixed conversation tabs](screenshots/unified-conversation-tabs.png) show both named tabs with the selected chat's preserved editable draft; the [workspace chooser](screenshots/main-panel-sources.png) has no separate global-following conversation choice. The isolated fixture intentionally has no model credential, so its settled failed turn is history/state evidence, not a successful external model request.

Dockview's `origin: user` is not sufficient evidence of user selection. A real ordered browser trace showed B opening and being acknowledged, followed by an automatic main-pane A activation while actual focus stayed on the sidebar button. Admission now requires actual DOM focus in that panel or its own group's native tablist. Explicit header/body pointers claim their own focus before dispatching semantic intent, including inactive tabs and two visible panes; genuine keyboard selection remains admitted. There is no second selection state, global listener, timer or focus cache. A rejected echo also restores the actor's selected presentation when that tab exists in the same surface; it never navigates or pulls a tab from another pane. During the callback the container's `activePanel.id` is authoritative—the individual panel's `isActive` flag can still be stale. Real-Dockview regressions reproduce both failures and protect pointer handoff and keyboard behavior.

The owned Lexical host leases only DOM attachment. When a legacy duplicate retires, it returns the same editor/model/draft to the surviving connected canonical host and restores that host's current editable gate. Old cleanup never detaches a newer owner; final cleanup detaches the editor. This is not independent simultaneous multi-clone editing, and the normal picker exposes no such clones.

## Empty fixed-thread welcome

A materialized empty Session uses the same native centered **Into the Unknown** welcome, workspace/preset/model controls and hero composer as the original New thread page. Workbench previously forced every embedded occurrence to active/hero-false, hiding that welcome even with no turn. It now supplies the proper native Factory inputs rather than copying welcome JSX, adding another InputBar or borrowing the global current conversation.

The policy is derived from the fixed provider's public lifecycle and target snapshots: running/active-target/established history is active; a prompt attempt is engaging rather than empty. Unsent draft text and the tab's title do not establish a turn. Loading unknown history and a continuable parent whose availability is pending settle without a false welcome. An authoritative native blank summary supplies the same early empty proof as native MainPanel. The native value-module owner is disabled by RichComposer, so Workbench reads these public facts locally rather than importing the disabled native client module; its table tests compare the result against the adopted native pure contract implementation.

The existing embedded body already has phase-aware centering/settling CSS. Its full-height flex parent, Session reference, Factory occurrence, native per-session view selection and editor stay in place. The first real message changes presentation to active chat without replacing the contenteditable DOM. Workspace selection retains the native explicit new-blank-Session navigation semantics; it does not silently retarget a kept conversation.

The [centered welcome](screenshots/empty-thread-welcome.png) is a genuine empty fixed Session in a registered scratch project. The browser regression checks the actual hero phase and center geometry, workspace-picker interaction, one editable scoped input, draft retention across a different existing chat and reload, 360/480 px and split panes, then the same editor element and Session ID after the first real user message. That message is state/layout evidence, not a claim about a successful external model answer. All 204 Workbench unit tests and strict types pass. The full 32-case browser run passes 31; its remaining close-journey setup still requested the old active-chat placeholder for a truly empty third Session. That setup now explicitly requires the hero and native welcome placeholder, and the same close assertions pass on the focused rerun. The catalog up/doctor/seed/New thread/welcome/shot/down pass has zero console/page/request/HTTP errors. A retained hidden welcome also exposed text-reach first-match drift in the verifier: visible text is now selected explicitly, backed by all 34 scratch-runtime tests.

## Long history and close ownership

The fixed conversation has a real full-height, min-zero flex host. SessionProvider and Slot outlets use `display: contents`; a generic block host left the embedded `flex: 1` conversation at intrinsic transcript height. Read-only live geometry showed a 7,396 px body inside an 865 px pane, with the input at 7,308 px; the native side flex host stayed 832 px high. The isolated long-history regression reproduces a 5,924 px body/input at 5,836 px in an 800 px viewport before the fix. With the host fixed, body/scroller stay 768 px, history still scrolls 5,924 px, and the original input is visible at 680 px. Actual wheel top/bottom, the final text range, editing, switching and reload are tested without Playwright auto-scrolling hiding the defect.

Closing goes through the canonical semantic/native owner first. If that owner already removed the occurrence, there is no second close. An exact surviving panel is retired with `api.removePanel`, not `panel.api.close`: the latter can replay user-neighbor navigation or operate on a disposed presentation. Actor selection reconciliation compares the container's `activePanel.id`, including when per-panel flags are stale during notification. A real Dockview red-first test proves both seams; the repeated-close browser scenario cycles three real conversations, preserves inactive-close selection and drafts, selects an existing neighbor on active close, closes all and reopens the same Session without new/retargeted chats.

Reusable [native terminal pages](terminal-pages.md) use the existing resource owner and can target any pane without forcing the right dock open.

## Permanent centre

Dockview's `groups` and `panels` include floating and popout windows; a nonempty collection does not mean the centre has a tab strip. Closing the last grid group into a floating neighbour used to leave an empty centre that the panel-count guard never repaired.

The main surface retains a populated **grid** group; a singleton may intentionally hide its tab row through the recoverable policy above. Its last docked group cannot close or merge into a floating/popout group. After a complete layout mutation or restore, an empty centre receives a chooser in an explicitly created docked group; a bare `addPanel` would follow a floating active group. Repair does not clear layouts, dispose resources or reconstruct existing views, and does not steal focus from a floated panel. Invalid empty/multiple-member hidden rows normalize to shown; a valid saved singleton stays hidden and offers its content recovery control. Auxiliary panes retain their own close/hide behavior.

## Reset ownership

The old Reset layout reset only the clicked Dockview/store. Semantic tabs could remain in right/bottom/nested panes, pending placement queues could reapply the move, and project-scoped arrangements could restore the broken placement later. Rebuilding the raw Conversation panel was insufficient because the semantic adapter correctly removes it when actor-owned chat tabs exist.

Reset coordinates all mounted roots and legacy side surfaces, indexed unmounted nested layouts, and semantic presentation scope caches. It cancels delayed placement and clears actual descendants before parents destroy them. It reconciles semantic tabs into main, then selects the **current Session** in a docked group—not the actor's last active tool. Main Tabs publishes the public native `uiSession.adapter.current` binding key as an optional derived current-session field. Recovery reuses that Session's existing semantic view and editor owner, then activates its existing tab through the normal actor action. If that conversation's tab was closed, Reset explicitly reopens the same Session through the tab owner before selecting it. Only a not-yet-materialized New thread or an absent semantic provider uses the native draft fallback; it is not an extra conversation type. Generated chooser/raw-conversation placeholders retire only after admission. No Session is guessed from retain counts or URL state, no new chat is created, and pins/order/history are not rewritten. Reusing the editor matters: same-session views share a Lexical editor, so cloning an input can leave a visible empty DOM despite a retained draft model. The owned composer also prevents stale unmount cleanup from detaching a newer DOM-root owner. Left Navigation/Threads defaults are restored and the frame-owned idempotent sidebar show port reveals the list, including after repeated resets or late mount. Recovered main and left layouts are saved synchronously. Chat history, semantic tab identities, order, preview/pin state and named layouts are retained. **Workbench: Reset layout** is globally registered in the command palette and can receive a user shortcut independently of any main surface.

## Permanent-centre verification

The old runtime fails three real-Dockview centre regressions and the real Shift-floating browser case: floating succeeds but the root has zero grid groups. Fixed code passes 163 Workbench, 40 Frame Layout, 118 Main Tabs and 46 Rich Composer unit tests (367 total), plus all four strict package typechecks. The editor-root regression uses actual React/Lexical; the current-session producer reads the installed native public binding.

All 26 Workbench journeys pass across scoped batches, plus two persisted-Frame journeys and four standalone Main Tabs journeys. The final Reset case retains the exact current semantic view, both conversations' drafts/history, pin and actor identity through repeated resets, reload, legacy empty-root/all-floating restoration and the real global command palette. It then drags the saved sidebar to 420px, repeats Reset at 360/480/768/1024px with both columns visible, and widens back to 1400px with the exact 420px preference retained. Fresh official-core CLI doctor and the catalog Reset walk pass with zero console/page/request/HTTP errors (one warning); the owned scratch instance is stopped. The [recovered chat layout](screenshots/layout-recovery.png) shows the left chat list and centre conversation.

Reproduce focused browser recovery from `tooling/dshx` with the pinned official-core/system-Chromium environment and rebuilt bundles: `DSHX_E2E_PREBUILT=1 DSHX_E2E_PREWARM=0 node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts workbench.feature --grep 'Floating the last centre tab keeps|Reset reveals the current chat'`. Main Tabs' read-only current-session metadata is backward-compatible; activation on the personal runtime still follows its existing HMR/Host-restart gate. Simultaneous editing across duplicate same-session clone views remains a separate limitation; Reset deliberately reuses one existing editor owner instead.

## Focused verification

Window-scope validation passes 134 Main Tabs tests and 188 Workbench tests, including eight real-actor scope regressions and three real-Dockview consumer regressions; both strict typechecks, builds and Host imports pass. The unchanged stock-core two-project fixture loses the ordinary chooser after B selection; fixed bundles pass the same assertions plus explicit close/reload. A full 43-case affected browser run passes 42; the remaining standalone native double-click case fails during its first-send precondition before double-click, then passes unchanged on the single focused retry. No product assertion is waived.

The repeated CLI reach also exposed an older hidden tool result winning a `.first()` locator after fixed conversations began retaining hidden histories. The verifier waits for a visible current result instead; its actual-browser selector regression and all 33 scratch-runtime tests pass. This is verifier readiness, not a new tab-state owner.

The scroll/close/terminal increment passes all 185 Workbench and 15 Sidebar Right unit tests, both strict typechecks, affected builds/Host imports and declared native-fork comparison. A full 30-scenario Workbench/native-resource browser run passes 28 cases, including all three new regressions; the two remaining cases pass after correcting fixture-only native-draft readiness and modal-menu dismissal. No product assertions are waived. The CLI up/doctor/catalog terminal/chat/chooser walks/shot/down also pass with zero console, page, request or HTTP errors in the terminal capture.

The native-only fixture can expose an editable workspace draft before any thread URL exists; only materialized semantic profiles require that identity before typing. Pane options must be dismissed before clicking a control outside its modal accessibility scope. One earlier isolated root-before-registration boot dropout passes on an unchanged retry; it is not treated as evidence of a scroll fix.

- Workbench unit tests use real Dockview APIs for repeated reset, moved/nested tabs, absent main, cancelled pending handoffs and remount persistence; picker tests cover per-group placement, existing-view movement, runtime exclusion and pane-local empty choices.
- `workbench.layout-recovery` moves a real pinned chat aside, saves/applies that layout, resets twice, reloads, and verifies the same main chat, composer and pin.
- `workbench.reusable-view-picker` verifies reusable choices with two actual threads and the sidebar's fixed-chrome/tab boundaries.
- `workbench.new-tab-chooser` covers a real chooser tab, search, the absence of global-following conversation clones and the single Settings hub.
- `workbench.quiet-pane-chrome` covers per-group Pane options, true split groups and pane-local close controls without a toolbar.
- `workbench.every-pane-views` opens the owned custom Threads view in all four panes and checks explicit movement into a collapsed left pane.
- Unified Workbench, drag/drop, saved layouts, semantic tabs, nested surfaces and responsive controls retain their browser journeys. Standalone Main Tabs remains covered separately without Workbench installed.
- `workbench.unified-surfaces` boots real legacy native settings and verifies mandatory tabbed ownership plus one-time visibility migration.
- `workbench.right-pane-toggle` uses the original registered sidebar shortcut, checks full-height pixel bounds with the bottom pane open, and preserves the exact live Scratchpad element, draft and mount count across close/reopen.
- The native-resource journey closes the dock, reloads the real saved resource providers, and verifies passive restoration neither reopens the pane nor advertises hidden targets as visible. Explicit reopening restores genuine preview, review and terminal contents.

Verification uses a disposable official-core profile. Never restart the running personal DSH to test this change.

### Complete fixed-conversation verification

- 176 Workbench,126 Main Tabs,50 Rich Composer and32 focused Sidebar unit tests pass; all four packages pass strict typechecks and built Host import checks.
- All27 Workbench journeys have passing evidence across the full run and failure-focused corrections. The final clean-bundle run passes `tab-semantics`, `right-pane-toggle` and `fixed-conversation-lifecycle` together: real visible messages and editable independent drafts, pinned/unread behavior, same-current close-all/reopen, legacy alias retirement, Reset/reload, and local presentation agreement with the actor. All12 standalone Main Tabs journeys also passed.
- Reproduce that final narrow run from `tooling/dshx`, after rebuilding the affected bundles and setting `DSHX_DSH_EXECUTABLE` to the installed stock CLI and `DSHX_CHROMIUM_EXECUTABLE` to the system Chromium executable:

  ```sh
  DSHX_E2E_PREBUILT=1 DSHX_E2E_PREWARM=0 node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts --workers=1 --grep '@scenario:workbench\.(tab-semantics|right-pane-toggle|fixed-conversation-lifecycle)(\s|$)'
  ```

- Scratch CLI up/doctor/chooser walk/shot/down report zero console, page, request and HTTP errors (two warnings in the final chooser capture). Fresh complete-chat and chooser screenshots are linked above. These fixtures intentionally do not assert successful external model calls.
- Native-fork comparison finds no undeclared/stale/missing changed delta. Its nonzero inventory result names nine added vendored files already present on the task baseline, not additions from this work. The live personal DSH is never restarted for verification; activation follows the actual supervisor/HMR gate.

### Historical chooser-first verification (before fixed-conversation unification)

- 142 Workbench and 59 Settings Shell unit tests pass, plus the Backlog renderer-context regression. All three modified source packages pass strict typechecks and built Host import checks.
- All 22 Workbench browser scenarios pass across focused batches: searchable group-local chooser tabs, independent current-conversation views, one real Settings hub, quiet controls at narrow widths, split/merge, native keyboard tabs, pin/unread/drafts, saved layouts, real resources and reset.
- The Backlog journey opens its chooser view, then preserves a kept semantic Backlog tab inactive beside a conversation through reload. The original API-context crash does not recur.
- Layouts is owned by a persistent overlay, not by ephemeral dropdown content. Chooser focus is restored after Dockview finishes portal/header activation without stealing focus from inactive panes. Drag journeys wait for real on-screen geometry before native pointer gestures; no synthetic drop is injected.
- Fresh scratch doctor and catalog walks for the chooser/right pane and real Settings hub report zero console, page, request and HTTP errors. Captures are refreshed beside the owning docs. Live DSH is not restarted for verification.

### Historical unified-surface verification (before the chooser redesign)

- 132 Workbench, 31 Frame Layout and 12 Sidebar-right unit tests pass; all three package typechecks and built Host imports pass.
- All 20 Workbench real-browser journeys pass, including legacy preference migration, the original right-sidebar keyboard binding, full-height right/bottom geometry, exact live draft retention, and closed-resource reload without passive reopening. All 12 standalone Main Tabs journeys pass across the full native run and the dependency-corrected Backlog rerun.
- Reproduce the Workbench browser set from `tooling/dshx` with the pinned official core and system Chromium environment: `DSHX_E2E_PREBUILT=1 DSHX_E2E_PREWARM=0 node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts workbench.feature`. Build the declared bundles first; prebuilt verification cannot boot an absent Backlog or Model Selection artifact.
- Scoped lint, feature/telemetry catalogs, generated browser inventory and declared native-fork deltas pass. This is a layout/functionality change, not a performance optimization; the maintained scratch measurement fixture now compares repeated runs of the same renderer.

### Historical 2026-10-26 verification receipt

These receipts predate the New tab/quiet-chrome redesign; they do not certify its current reach paths. The coordinating parent runs fresh catalog, source and scratch verification.

- 131 Workbench unit tests passed. Related packages passed 482 Thread Sidebar, 105 Main Tabs, 45 Rich Composer and 22 Frame Layout tests (785 total).
- All 19 Workbench browser journeys passed across the full run and the focused rerun. The full run initially passed 18; the native-resource journey had not booted because Model Selection was not built in the fresh worktree. Building that declared dependency and rerunning the resource journey plus the three new pane/recovery journeys passed all four. Both composed sidebar smoke journeys passed.
- Workbench, Thread Sidebar, Frame Layout and Rich Composer typechecks/builds and built Host import checks passed. Catalog and scoped lint checks passed. Scratch doctor reported all 17 requested bundles loaded with no Host errors, and screenshot evidence reported zero console/page/request/HTTP errors. The scratch instance was stopped.
- Broader single-plugin Rich Composer/Thread Sidebar fixtures remain blocked before interaction by their pre-existing missing `sessionDrafts` provider. Their base sources already require the owned Session Controller; supported explicit compositions above are green. Recorded as papercut `p_8948dade58`, not hidden by relaxing boot checks.
- Native-fork drift reports no changed vendored files in this task. The existing Rich Composer provenance check still reports its already-added native helper/test files; this change does not modify that baseline.
