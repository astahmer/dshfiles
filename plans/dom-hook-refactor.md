# DOM hook refactor plan

## Context

Several owned plugins extend DSH-rendered UI by finding and mutating host-rendered DOM rather than contributing through a render contract:

- `agents`, `backlog`, `memory`, and `jujutsu` scan rendered conversation text and wrap recognized references in interactive elements; `mentions` tags existing session-reference chips. Examples: [agent references](../plugins/@dshfiles/agents/src/agent-reference-links.ts), [backlog references](../plugins/@dshfiles/backlog/src/backlog-reference-links.ts), [memory references](../plugins/@dshfiles/memory/src/memory-reference-links.ts), [JJ references](../plugins/@dshfiles/jujutsu/src/chat-reference-links.ts), and [session mentions](../plugins/@dshfiles/mentions/src/client-entry.ts).
- `ai-accounts` appends estimated cost to the native usage pill and its dialog in [session-cost-display.ts](../plugins/@dshfiles/ai-accounts/src/session-cost-display.ts).
- `main-tabs` inserts a strip host immediately before the frame's `main` outlet in [strip-mount.ts](../plugins/@dshfiles/main-tabs/src/strip-mount.ts); the frame currently has no slot at that placement ([frame SlotMap](../plugins/@dshfiles/frame-layout/src/native/client/index.ts)).
- `thread-sidebar` marks selected rows imperatively in [thread-selection.ts](../plugins/@dshfiles/thread-sidebar/src/thread-selection.ts), and finds the main composer by DOM selectors in [thread-mention.ts](../plugins/@dshfiles/thread-sidebar/src/thread-mention.ts).

The repository owns the relevant UI boundaries (`@dshfiles/chat`, `@dshfiles/frame-layout`, and `@dshfiles/thread-sidebar`), so the plan is to add narrow typed extension points there instead of patching DSH core. Ordinary portals for dialogs/menus, DOM reads for focus or geometry, and observers used only for layout/theme measurement are not targets.

## Goal

Replace these host-DOM UI workarounds with owner-provided, typed render or context contracts while preserving current behavior and appearance.

## What

In scope:

1. An inline-reference rendering contract in the owned chat renderer, used by agent, backlog, memory, JJ, and session-reference features instead of scanning and rewriting rendered message DOM.
2. An additive contribution point in the owned chat usage-stats UI for the session-cost estimate and its per-bucket detail rows.
3. An explicit frame-layout seat before the main panel for the main-tabs strip.
4. React-owned selected state for thread rows, and a typed current-composer/session context for thread-mention targeting if existing APIs do not already provide it.
5. Focused tests and browser journeys proving the new contracts and unchanged user behavior.

Out of scope: removing all DOM APIs, changing visual design, changing DSH core, replacing standard React portals, or building a general-purpose DOM injection framework.

## Why

DOM selectors and mutation observers couple plugin features to implementation markup. A harmless host layout or renderer change can silently remove a feature, and document-wide observers add lifecycle and streaming-content complexity. Owner-provided contracts make ownership, supported locations, and failure behavior explicit.

## How

### Conceptual model

The owner renders a stable extension point and passes typed, domain-level data. Consumers contribute React output or state; consumers do not locate or rewrite the owner's rendered nodes.

```text
Chat renderer ── inline-reference contract ──> agents / backlog / memory / JJ / mentions
Chat usage UI ── usage-stat contributions ───> ai-accounts
Frame layout ─── before-main slot ───────────> main-tabs
Thread sidebar ─ React row state + composer context ─> selection / thread mentions
```

### Operations / behavior

- The chat renderer identifies recognized inline-reference ranges while rendering messages and renders their accessible interactive components as React children. Preserve click, keyboard, selection, preview-anchor, and streaming-update behavior. Define deterministic ordering and overlap behavior for multiple contributors.
- The usage-stats owner renders additive cost content and cost breakdown rows from a typed contribution. The cost plugin supplies estimates; it does not append nodes to native buttons or dialogs.
- The frame renders an additive `before-main` seat at the intended strip position. `main-tabs` contributes its strip there and retains its existing tab state, navigation, and hidden-panel behavior.
- The thread list passes selection state to its own row components so React updates only affected rows. Thread-mention insertion receives the target composer session through an owned context/API; reuse an existing typed service if it already supplies the required identity.
- Missing or incompatible contributions fail visibly through the existing slot/plugin diagnostics rather than silently disappearing after a markup change.

### Tech choices

| Choice                                                      | Decision                                                         | Rationale                                                                                           |
| ----------------------------------------------------------- | ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| DOM observers and selectors vs owner-rendered contributions | Owner-rendered typed contracts                                   | The owner controls its UI and can preserve semantic behavior without post-render mutation.          |
| Shared generic DOM hook utility vs domain APIs              | Domain-local contracts in chat, frame-layout, and thread-sidebar | These owners have different data and placement semantics; avoid a generic injection abstraction.    |
| DSH core patch vs owned plugin changes                      | Owned plugin changes only                                        | The repository policy forbids core patches, and these UI owners are already replaceable/owned here. |
| Persistent state                                            | No new persistent state                                          | Existing references, costs, tabs, and selection retain their current storage/lifecycle.             |

### Architecture

```text
Plugin contribution
  ├─ reference matcher/component ──> chat inline renderer ──> rendered message
  ├─ cost estimate/details ────────> chat usage-stat slot ──> usage pill/dialog
  ├─ tab strip ────────────────────> frame before-main slot ──> main panel frame
  └─ thread selection/context ────> thread-sidebar React rows/composer API

No feature locates and mutates another owner's rendered UI.
```

## What this allows

- Reference links and cost estimates remain visually integrated while being rendered and cleaned up by their owner.
- Layout changes in the frame can preserve the tab-strip placement through a named contract.
- Thread selection and composer targeting use React/service state rather than markup discovery.
- Future plugins can contribute through documented, typed extension points where the behavior is genuinely shared.

## What this does not allow

- Arbitrary injection into any DSH-owned DOM location.
- Reliance on private selectors as a fallback when a contract is unavailable.
- A promise that unrelated host markup never changes; contracts remain versioned and tested.
- Removal of DOM access required for ordinary focus management, geometry, portals, or measurement.

## UI & UX

### Desktop

No intended layout or visual change. Reference chips, cost estimates, the tab strip, and selection highlights stay in their current locations and retain their current interactions.

### Common interactions

| Action                                            | Result                                                                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Click or keyboard-activate a recognized reference | Opens the same reference preview/navigation as today.                                |
| View token usage                                  | Shows the same estimate and per-bucket details, contributed through the stats owner. |
| Switch main panels or open tabs                   | The strip stays above the main panel without manual DOM insertion.                   |
| Select threads and insert a thread mention        | Selection and target session stay correct as rows/composers mount or update.         |

## Data model

No database or persistent-schema changes. Add only typed client-side contribution/context contracts owned by the UI packages; keep plugin settings and existing reference payloads unchanged.

## Implementation steps

1. Audit the named implementations and their existing tests/journeys; record exact behaviors, owners, selectors, and required props before changing contracts.
2. Design and test the inline-reference contract in `@dshfiles/chat`, including multiple contributors, overlapping matches, streaming updates, user/assistant content, accessibility, and preview anchoring.
3. Migrate `agents`, `backlog`, `memory`, `jujutsu`, and `mentions` to that contract; remove their transcript `MutationObserver`/DOM rewrite paths and add focused rendering tests.
4. Add an additive usage-stat contribution to `@dshfiles/chat`; migrate `ai-accounts` cost display and remove native-button/dialog DOM mutation.
5. Add a before-main frame slot to `@dshfiles/frame-layout`; migrate `main-tabs` and remove the outlet watcher/manual anchor insertion.
6. Render thread selection through `thread-sidebar` React row props; replace composer-seat discovery with existing typed context or add the smallest owner-side context contract.
7. Run focused package tests, typechecks/builds, workspace contract checks, and scratch-DSH browser journeys for each affected UI. Verify no targeted code still mutates host-rendered message/stat/frame/thread nodes, then update package docs and screenshots if the user-visible feature placement changes.

## Open questions

1. Should the inline-reference contribution contract be public to any compatible plugin, or initially exposed only to the owned dshfiles consumers until its ordering and overlap semantics prove stable?
2. Does the existing conversation context expose the main composer session identity needed by thread mentions, or is a small typed owner-side context addition required?

## Acceptance criteria

- [ ] No reference feature scans the whole document and wraps/replaces rendered message text after render.
- [ ] No cost-display code appends or removes nodes inside the native usage pill or dialog.
- [ ] `main-tabs` renders through a declared frame slot and does not insert a sibling beside `[data-slot="main"]`.
- [ ] Thread selection is represented in React-owned row props; composer targeting does not depend on querying composer-seat markup.
- [ ] Existing reference, usage, tab, and selection interactions pass focused tests and real-browser journeys, including content streaming and remounts.
- [ ] Contracts have typed declarations, owner documentation, cleanup/lifecycle coverage, and a visible compatibility failure path.
- [ ] No DSH core patch or new persistent data schema is introduced.

## Decisions log

| Date       | Decision                                                                                           | Rationale                                                                                         |
| ---------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| 2026-10-28 | Refactor at owned plugin boundaries, not through DSH core or a generic DOM injection helper.       | Chat, frame-layout, and thread-sidebar own the affected UI; contracts should reflect each domain. |
| 2026-10-28 | Preserve standard portals and DOM reads/observers used only for focus, geometry, layout, or theme. | The goal is to remove cross-owner UI mutation, not ban normal browser APIs.                       |
