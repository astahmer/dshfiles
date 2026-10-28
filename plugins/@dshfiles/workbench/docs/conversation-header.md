# Conversation header

Every fixed conversation keeps the original Rich Composer header above its body. It includes the session title/breadcrumb, preset label, contributed Jujutsu/workspace utilities, Pin and **More thread actions**, and the native **Chat / Trajectory / Traces / Requests** navigation. Optional controls and tabs appear only when their original providers and session phase allow them. The Workbench conversation tab row remains separate; no second global-following header or copied menu is introduced.

## Ownership

The original header was outside the reusable `conversation.content` Factory. Hosting only that Factory omitted the header, and the former local Views component forced Chat even when the native per-session view store selected something else.

The public [`conversation-header` module](../src/conversation-header.ts) declares a small presentation contract. Rich Composer already depends on Workbench, so the implementation imports that contract without introducing a reverse package/build dependency. Rich Composer registers its Factory and moves the **single** `conversation.header` child declaration out of its native main entry. Both native MainPanel and fixed Workbench conversations call the same Factory. The original Header/SessionHeader components and their child contributions remain unchanged and authorized; no foreign slot capability, stock SDK field or private component is copied.

The fixed panel's existing retained SessionProvider surrounds the header and body together. Pin, Copy, workspace and view callbacks therefore address that panel's Session, including when another conversation is selected or two panes are visible. Native per-session view selection drives the existing content Factory; its original editor, draft and blank/settling/active policy stay resident. Explicit view-only panels still omit the composer.

Workbench supplies the layout-only `reserveHostCorner` input. Its wrapper leaves 32 px clear for the host's **Show tab row** affordance. Without this clearance, the real recovery overlay intercepted the restored More button after hiding a singleton row. The original toolbar is neither moved nor restyled; native callers omit this input and receive the original bare header. The body width and editor are unaffected.

The original **Open right sidebar** corner button is expand-only. In Workbench, Sidebar Right observes and opens the registered frame `DockPaneActions`; a retained native Session's hidden carrier cannot determine visible dock state. The button disappears while open, the pane's own **Close pane** closes it, and the original opener returns. Native mode keeps its per-session expansion behavior.

## Verification

The owning Workbench (244), Rich Composer (55) and Sidebar Right (19) suites pass: 318 tests cover real SlotCore sole-declaration/cascade/re-registration, fixed references, original composition, independent view stores, resident editor identity and native/dock expansion boundaries. Strict types and Host/public-module imports also pass.

From the repository root:

```sh
pnpm --dir plugins/@dshfiles/workbench test
pnpm --dir plugins/@dshfiles/rich-composer test
pnpm --dir plugins/@dshfiles/sidebar-right test
```

The real browser journey uses seventeen explicit original providers, a receiver on port 0, two genuine Host-created conversations, real pointer docking, native menus and the actual clipboard. It checks title/mode/workspace controls, all four child tabs, session-specific Copy and Pin/Unpin, two visible headers, independent Traces/Requests identity, the same editor/draft, hidden-row recovery, reload and widths 360/480/768/1024. It never forces a click, injects tab state or uses model credentials.

From `tooling/dshx`, with `DSHX_E2E_PREBUILT=1`, `DSHX_E2E_PREWARM=0`, the official-core executable in `DSHX_DSH_EXECUTABLE` and installed Chromium in `DSHX_CHROMIUM_EXECUTABLE`:

```sh
node node_modules/playwright-bdd/dist/cli/index.js --config=playwright.e2e.config.ts
node node_modules/@playwright/test/cli.js test --config=playwright.e2e.config.ts --workers=1 --grep '@scenario:workbench.conversation-header'
```

A hidden group intentionally has no tab-row Close pane button. The journey uses **Show tab row** before that close instead of bypassing the UI. Pin may fold/unfold while the native ResizeObserver settles after docking; the journey follows its real responsive placement. Neither behavior changes product assertions.

The broader five-case regression command passes standalone navigation customization, legacy-disabled fixed tabs, fixed-conversation close/reopen/reload and reusable view picking. The older single-package Rich Composer paste fixture is blocked before any interaction: it omits the owned `sessionDrafts` provider and leaves twelve entries pending. That known composition issue is tracked as `p_8948dade58`; it is not presented as a passing batch or a header product regression.

The retagged header journey and genuine native preview/review/terminal resource journey also pass together after regeneration. With the empty-welcome case and four successful existing regressions, seven distinct real-browser journeys pass across focused runs.

The named scratch doctor, header catalog reach and original title-rename reach also pass. The stock optional application icon uses its intentional fallback glyph: isolated XDG roots hide the installed Nix VSCode artwork while PATH still exposes its launcher. Its two image 404s and matching console entries are retained in evidence, with zero page/request errors; this does not prove or attempt an external application launch. The separate verifier follow-up is `p_19fa8256ef`, not a reason to weaken isolation or patch stock DSH.

The restored toolbar is shown in [the focused header capture](screenshots/conversation-header.png), [two independent panes](screenshots/conversation-header-split.png) and [the narrow capture](screenshots/conversation-header-narrow.png). Screenshot threads and drafts are synthetic. The live GUI is not refreshed or restarted for verification.
