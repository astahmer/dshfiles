# 6. Progressive disclosure and zen mode

Research and design only. Repo: `~/dev/dshfiles-threads/freeze-fix` (paths below are relative to it). Nothing was
built or run. Line numbers were read on 2026-11-12.

## 0. Summary

1. **Show less, don't load less.** Disclosure hides chrome. It does not disable plugins. Enabling an installed
   plugin can apply live, but installing one needs a Host restart (`pack-plan.ts` `restart: 'required'`), and the
   Host half (agent tools, APIs, attention) must keep working whatever the screen shows. Packs stay the tool for a
   lean Host. Disclosure is a separate, cheap, reversible presentation layer.
2. **Tiers go on packs, not on 560 features.** `plugins/@dshfiles/onboarding/src/packs.ts` already groups the
   plugins that carry chrome into 8 packs. Add a `tier` to each pack, plus a rare per-feature override in
   `dshx.features.json`. A plugin in no pack stays visible, so the safe default is "shown".
3. **Unlock signals already exist.** `SUGGESTION_RULES` (`onboarding/src/suggestions-model.ts`) are usage
   thresholds tied to catalog features, the checklist (`setup-facts.ts`) gives prerequisite facts, and
   `reach`/`open` routes give a "Show me where" for each feature. Progressive disclosure is "a suggestion that
   reveals", shown where the user needs it and not on a tour.
4. **Zen mode belongs to `frame-layout`.** It already owns the columns, the sidebar width, the right-panel mode and
   the status strip (`frame-layout/src/regions.ts`, `right-panel.ts`, `native/client/AppFrame.tsx:228`). It sets
   one root attribute (`data-dshfiles-zen`), and the shell owners that change layout react to it. The precedent
   is `workbench`'s `data-workbench-main-tabs` (`workbench/src/header-seat.ts:37`, `client.tsx:1516`).
5. **One choke point covers most plugin chrome.** Every dshx registry contribution (`Panel`, `ComposerAction`,
   `ComposerTool`, `ComposerPill`, `HeaderAction`, `SessionRowAccessory`, `Overlay`) and every declarative
   `definition.slots` entry goes through `IsolationModel.isolate(component, { owner, id })`
   (`tooling/dshx/packages/dshx/src/client/isolation.ts:49`, `registries.ts:176-185`, `runtime.ts:371-381`). A
   visibility gate there, keyed by owner package and contribution id, can hide a contribution without
   unregistering or remounting it. Raw `ctx.slots.inject` calls from ported native code bypass it. That set is
   listed in §2.3.
6. **Thin first slice:** zen mode alone (frame-layout attribute, one palette command, four existing levers). It is
   independent of disclosure and gives an immediate result. Disclosure follows in four slices.

## 1. What the plugin system can do today

### 1.1 Loading and enabling

| Lever                           | Where                                                                                                                                    | Live?                                   | Notes                                   |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- | --------------------------------------- |
| Profile membership              | `profiles/web/package.json` (`link:` deps), reconciled by profile-sync (`docs/profile-installs.md` §"The web profile reconciles itself") | No: DSH reads the profile at boot       | Installing is a restart                 |
| Row config / disable            | `profiles/web/cordis.patch.yml` (296 lines; e.g. `session-query-sqlite disabled: true`)                                                  | Restart                                 | Patch replaces a row's whole `config`   |
| Enable/disable an installed row | native plugin manager `setPluginEnabled` → `applied` / `restart-required` / `overridden` (`onboarding/src/plugin-manager-promise.ts`)    | Usually live                            | Host halves may report restart-required |
| Pack enable/disable             | `onboarding/src/pack-plan.ts`, `pack-controls.ts`, `onboarding_pack_apply` (needs `confirm: true`)                                       | Row changes live; installs need restart | Exact preview, Core never disabled      |
| Auto-restart when idle          | `thread-sidebar` `autoRestartWhenIdle` (off by default)                                                                                  | —                                       | Needs the supervised launcher           |
| Client hot reload               | `hmr-gate` holds a client rebuild whose Host half changed (`hmr-gate/README.md`)                                                         | Yes, gated                              | Dev concern only. Not a disclosure path |

Conclusion: changing what is _installed_ or _enabled_ to "disclose" a feature costs a restart or risks the Host.
Gating _presentation_ costs nothing and can be undone at once.

### 1.2 The feature catalog

1. `tooling/dshx/packages/dshx/src/project/features.ts` defines each feature: `surface`, `destination` (`threads,
inbox, land, work, agents, observe, knowledge, settings, thread-panel, composer, transcript, none`), `states`,
   `telemetry` (`automatic` sources `api-dispatch | agent-tool | model-stream | jj | secret | multi-host`, or a
   `custom` span), and the optional `onboarding` block (`prerequisites`, `firstAction`, `doneWhen`, `open` =
   panel | command | settings), lines 160-186.
2. Generated into `plugins/@dshfiles/onboarding/src/generated/feature-catalog.ts` (29k lines, ~560 ids). Its
   staleness test fails on drift. `curation.ts` holds the curated "major" list (Appendix A of
   `plans/onboarding/README.md`).
3. P5a: 85 onboarding blocks on 70 UI plugins, 9 infrastructure plugins exempt, and `features:check` fails a UI
   plugin without a block. P5b (pack membership for every UI plugin) **waits on a user decision**
   (`plans/onboarding/README.md:3`). Tiers-on-packs depends on that decision (§5, Q1).

### 1.3 Local signals that could drive "unlock when relevant"

| Source                                                         | What it gives                                                                                                                                           | Cost / gate                                                                                                                            |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `usage` API `activity` + `charts` (`usage/src/api.ts:530-589`) | tool counts, shell executable counts, errors, turns, longest thread, compaction requests                                                                | Already read by `onboarding/src/usage-suggestions.ts` (10 min TTL); **opt-in** via `dshfiles-onboarding.suggestions` (default `false`) |
| `SUGGESTION_RULES` (`suggestions-model.ts:47-131`)             | 7 rules: jj→thread workspaces, jj→revision graph, long threads→compaction meter, gh→pull requests, todo_write→backlog, tool errors→traces, turns→memory | Pure, unit-tested, catalog-validated                                                                                                   |
| Checklist (`setup-facts.ts`, `first-run.ts`)                   | `account`, `project`, `repository`, `github` done/todo                                                                                                  | One Host read, `gh` cached 60 s                                                                                                        |
| `traces` `stats` (`traces/src/api.ts:136`)                     | per span-name counts over a window, so `api-dispatch` spans per plugin API, i.e. "this plugin's API was used"                                           | Not used for this yet. Needs traces on. Unverified that span names map cleanly to plugin ids                                           |
| Client events at the moment of need                            | first diff in a thread, first `gh` command, first subagent, first failed turn, first quota hit                                                          | Not built. Owners already observe these for their own rows/cards                                                                       |

## 2. Chrome surfaces and what hides them today

### 2.1 Inventory

| Surface                                       | Owner                                                                                                                                                                                                        | Hide lever today                                                                                                                                     | Gap                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Left sidebar width / collapse                 | `frame-layout` (`AppFrame.tsx:228` `layoutInfo.sidebar === 0`)                                                                                                                                               | UI collapse (browser)                                                                                                                                | No programmatic "hide" setting; zen needs a seat                   |
| Rail destinations + sections                  | `thread-sidebar` (`destinations.ts:50` `DestinationSections`, `:78` `resolve`)                                                                                                                               | `hiddenHeaderIds` / `headerOrder` / `hiddenFooterIds` (Customize sidebar, `settings.ts:259-262`), `headerMode`, `navigationDensity`                  | No filter by pack/tier                                             |
| Sidebar header/footer actions                 | `thread-sidebar`                                                                                                                                                                                             | `hideBrandLogo`, `showFooter`, `showRailActions`                                                                                                     | —                                                                  |
| Thread rows                                   | `thread-sidebar`                                                                                                                                                                                             | `threadRow{Project,ProjectColor,Title,Machine,Path,Time,StatusDot}`, `threadRowDensity`, `hiddenRowActions`, `finishedSubagents`, `subagentRunCards` | —                                                                  |
| Main tabs                                     | `main-tabs` + `workbench`                                                                                                                                                                                    | `dshfiles-workbench.showMainTabs` → root `data-workbench-main-tabs`                                                                                  | —                                                                  |
| Bottom pane                                   | `workbench`                                                                                                                                                                                                  | `bottomPanel: hidden` (default)                                                                                                                      | —                                                                  |
| Right panel / thread facets                   | `frame-layout` seat + `sidebar-right` (16 `sidebar.right.pane.tab` injections)                                                                                                                               | `RightPanelSeat.setMode` (`right-panel.ts`)                                                                                                          | No per-facet hide; `sidebar-right` settings only `residentThreads` |
| Status strip                                  | `frame-layout` (`status-strip-preferences.ts`)                                                                                                                                                               | `hiddenStatusItems`, `statusItemOrder`                                                                                                               | No "hide strip" switch                                             |
| Conversation header utilities/actions (pills) | raw `conversation.session.header.{utilities,actions}` slots in ~12 plugins (agent-preset, jj-integration, jujutsu, multi-host, preview, schedule, sidebar-terminal, thread-sidebar…)                         | None                                                                                                                                                 | **No central lever**                                               |
| Composer controls                             | `rich-composer` (`composer-controls-settings.ts`)                                                                                                                                                            | `hidePermissionSelector`, `showComposerExtras` (off), `showAgentPresetPicker` (off)                                                                  | —                                                                  |
| Composer state stack (rows above composer)    | `plugin-ui` `ComposerRow` (`components/composer-row.tsx`); users: `queue-reorder`, `background-jobs/job-preview`, `rich-composer` TodoPanel; plus `conversation.input.dock` (10) / `.overlay` (4) injections | None                                                                                                                                                 | **No registry, no priority, no hide**                              |
| Composer pills/tools/actions                  | dshx `ComposerPill/Tool/Action` registries                                                                                                                                                                   | None per item                                                                                                                                        | Gate via IsolationModel                                            |
| Transcript cards                              | `conversation.chat.node` (17), `turnTail` (4), assistant-actions (3)                                                                                                                                         | Per-plugin settings, rarely                                                                                                                          | Out of scope for zen (content, not chrome)                         |
| Command palette                               | `command-palette`                                                                                                                                                                                            | —                                                                                                                                                    | **Must never be filtered**: it is the escape hatch                 |
| Inbox glyph / attention                       | `thread-sidebar` attention + Inbox destination                                                                                                                                                               | `*NeededDisplay` group/label                                                                                                                         | Attention must bypass disclosure and zen                           |
| Overlays / toasts                             | `shell.overlay` (23 injections)                                                                                                                                                                              | —                                                                                                                                                    | Keep. Owners self-limit                                            |
| Settings sections                             | `settings.section` (12)                                                                                                                                                                                      | —                                                                                                                                                    | Keep visible. Hidden features stay findable here                   |

### 2.2 Is there a central "layout/density" setting?

There is none. Density is spread across owners: `thread-sidebar.navigationDensity`, `threadRowDensity`, `headerMode`;
`workbench.showMainTabs`, `bottomPanel`; `rich-composer` extras. The "one sidebar layout" merge (`thread-sidebar`
`layoutMode`/`layoutMerge`, now `.hidden()`, `settings.ts:54-61`) retired `fixed`/`docking` as a sidebar choice. Free
docking lives on as the advanced Workbench mode (`docs/ade-ux/README.md:223-226`). ade-ux already prescribes the
rule this design needs: "**Progressive disclosure budget:** first-level rail entries are chosen from usage data.
Everything else goes through More or the palette. No third level." (`docs/ade-ux/research/prior-art.md:491`). The
same doc lists "No new chrome" (`docs/ade-ux/README.md:378`) and a status strip of ≤ 1 item per plugin.

### 2.3 Contributions the IsolationModel gate cannot reach

Raw `slots.inject` from ported native code: `conversation.session.header.*`, `conversation.input.dock/overlay/right`,
`sidebar.right.pane.tab*`, `shell.overlay`, `main` (33). Each needs either a migration to a dshx registry or an
explicit owner check. This list is the "long tail" for D4.

## 3. Design

### 3.1 (a) Tier model

Four tiers, assigned to packs (`packs.ts`). Lowest tier wins when a plugin sits in several packs. Unpacked UI
plugins count as Core until P5b classifies them.

| Tier      | Packs / plugins                                                                                                                                                                                                                                   | Visible when                                                                                                                                | How it is offered                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core**  | Core pack (thread-sidebar, main-tabs, chat, rich-composer, session-controller, settings-shell) + composer/transcript basics (`mentions`, `model-effort-picker`, `html-render`, `mermaid-diagrams`, `attachment-gallery`, `agent-questions` cards) | Always                                                                                                                                      | —                                                                                                                                                                                            |
| **Daily** | Versioning (jj-integration, jujutsu, diff-viewed, session-undo), Knowledge read side (session-search, prompt-stash, fff-search), Accounts basic (ai-accounts quota)                                                                               | Its **prerequisite fact** turns true (`repository` → Versioning; `account` → quota), **or** the setup wizard finishes, **or** 3 active days | Owner's own empty state or the first moment of need (first diff → "Changes" facet appears with a one-line ComposerRow: "This thread changed 4 files. Review them in Changes." [Open] [Hide]) |
| **Power** | GitHub & review, Backlog & planning, Observe & perf, memory, references, usage dashboards, traces                                                                                                                                                 | A **signal rule** fires (existing `SUGGESTION_RULES`, plus new event rules)                                                                 | Contextual nudge (§3.1.2), or the Getting started "Hidden for now" list                                                                                                                      |
| **Fleet** | Agents & orchestration (agents, agent-communication, background-jobs, multi-host), phone-pairing/phone-access, project-automations, schedule, thread-share, whiteboard                                                                            | **Explicit opt-in only** (Enable from Getting started / palette), or using one of its commands from the palette                             | Never nudged automatically, except the one rule "≥ N subagents in a week → Agents"                                                                                                           |

Infrastructure plugins (no `client` surface, `destination: none`) are not disclosed at all.

#### 3.1.1 Unlock rules (data, not code paths)

Extend the existing rule type rather than adding a second one:

```ts
// onboarding/src/disclosure-model.ts (new, next to suggestions-model.ts)
type RevealTrigger =
  | { readonly kind: 'prerequisite'; readonly id: Prerequisite } // checklist fact turned done
  | { readonly kind: 'usage'; readonly rule: SuggestionRule['id'] } // reuse SUGGESTION_RULES thresholds
  | { readonly kind: 'event'; readonly event: DisclosureEvent } // client moment of need
  | { readonly kind: 'days'; readonly activeDays: number } // Daily only
type DisclosureEvent = 'thread-diff' | 'gh-command' | 'subagent-started' | 'turn-failed' | 'quota-hit' | 'long-thread'
```

A pack lists its triggers in `packs.ts` next to `prerequisites` and `keySettings`. A catalog test checks every
`usage` rule id and every feature key.

Ground rules:

1. **Using reveals.** Running any command of a hidden feature (from the palette, a link, `Show me where`,
   `ctx.layout.openPanel`, an agent's `onboarding_reach`) reveals that feature's pack at once and records
   `by: 'use'`. A user never lands on an empty spot.
2. **Attention bypasses disclosure.** A question, approval, quota block or land conflict from a hidden plugin
   always renders and reveals its pack.
3. **Usage rules need the user's opt-in.** They run only while `dshfiles-onboarding.suggestions` is on, which is
   off by default (privacy decision already taken). Prerequisite and event triggers need no usage read, so they
   work for everyone.

#### 3.1.2 How it is offered

Nudges appear at the moment the user needs them. There are no tours.

1. **Where:** in this order, (a) the owner's empty state (64 of 77 `<EmptyState>` uses have no action today: the
   disclosure action fills that slot), (b) one `ComposerRow` above the composer when the thread is idle, (c) the
   Getting started page's "Hidden for now" section. Never in the Inbox, which is attention-only per ade-ux R7, and
   never as a toast (R9: toasts confirm the user's own action).
2. **Copy:** evidence plus one sentence plus two buttons, reusing the `Suggestion` shape (`evidence`, `why`,
   `feature`). Example: "38 jj commands, no thread workspace yet. A thread workspace keeps parallel threads apart.
   [Show me] [Not now]". `[Show me]` reveals the pack and runs the feature's `reach` walk (P2 Show me where).
3. **Budget:** at most one nudge per day, none while a turn runs, none in zen mode. "Not now" snoozes for 30 days.
   "Never" (in the row's ⋯ menu) dismisses that pack for good.

### 3.2 (b) Zen mode

**On screen:** the transcript, the composer (input, send/stop, model chip), and one attention glyph (count of
threads that need you, clickable, opens the palette on those threads). Blocking interactions always render: the
question card, approval, quota choice, run cards of the current thread's working subagents.

**Hidden:** the left sidebar and rail, main tabs, the right panel/thread facets, the bottom pane, the status strip,
conversation header utilities/actions (pills), non-blocking ComposerRow rows (queue, todo panel, job preview),
composer pills/tools, and nudges.

**Toggle:**

1. A palette command `Zen mode` (`frame-layout`), with a default chord in the shared command-keys grammar
   (`tooling/dshx/packages/dshx/src/client/command-keys.ts`). Proposal: `mod+shift+.`. Conflicts must be checked
   against `@dshfiles/shortcuts`. Escape is taken (interrupt), so it cannot exit zen. The same command exits.
2. An exit affordance stays on screen in zen: the attention glyph's ⋯ menu has "Leave zen".
3. **Per window, global by default.** Optional "Remember zen for this thread": a browser-local set of session ids
   (bounded, 50). Opening that thread enters zen, and leaving it restores the previous state.

**State:** browser-local, as `docs/client-state-ownership.md` classifies window presentation. Key
`dshfiles.frame-layout.zen.v1` = `{ on: boolean, threads: string[] }`, decoded with a schema, missing means off.

**Implementation hooks:**

| Piece                | File(s)                                                                                                                                                     | What                                                                                                                                                                                                                                                                                                                                              |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Seat + attribute     | `plugins/@dshfiles/frame-layout/src/regions.ts` (new `ZenSeat` beside `MainSurfaceSeat`/`RightPanelSeat`), `native/client/AppFrame.tsx`, `client-entry.tsx` | Observable `{ on, set, subscribe }` via `ctx.get('zen')`. AppFrame sets `document.documentElement` `data-dshfiles-zen="on"` and, while on, collapses the sidebar column and the right panel and drops the status strip **in its own layout math** rather than through CSS, so the geometry stays consistent (`frame-widths.ts`, `right-panel.ts`) |
| Command              | `frame-layout/src/client-entry.tsx`                                                                                                                         | `Zen mode` command + chord. `dshx.features.json` entry with `destination: none`, surface command, a `reach`                                                                                                                                                                                                                                       |
| Main tabs            | `workbench/src/client.tsx:1516`, `header-seat.ts`                                                                                                           | Read the zen seat: tabs hidden while zen, without writing `showMainTabs`                                                                                                                                                                                                                                                                          |
| Header pills         | `rich-composer/src/native/skeleton/ConversationSession.tsx` (renders `conversation.session.header.*`)                                                       | Skip the utilities/actions slot render while zen. One owner, so all ~12 contributors are covered                                                                                                                                                                                                                                                  |
| ComposerRow stack    | `plugin-ui/src/components/composer-row.tsx`                                                                                                                 | Add `blocking?: boolean`. In zen, non-blocking rows render null (CSS `:root[data-dshfiles-zen=on] [data-composer-row]:not([data-blocking])` is enough, since rows are not layout-critical)                                                                                                                                                        |
| Composer pills/tools | dshx gate (§3.3) with a zen rule: hide every `ComposerPill/Tool` not marked `essential`                                                                     | —                                                                                                                                                                                                                                                                                                                                                 |
| Attention glyph      | `thread-sidebar` publishes its attention count through its existing contract. `frame-layout` renders the glyph in zen only                                  | Reuses `thread-sidebar-attention`                                                                                                                                                                                                                                                                                                                 |

Zen never writes owner settings (`showMainTabs`, `hiddenStatusItems`, sidebar width), so leaving zen restores
exactly the previous state without a snapshot.

### 3.3 (c) Minimum infrastructure

**Reuse the feature catalog and packs; do not add a second registry.** The "disclosure registry" is
`PACKS` + `tier` + `reveal` triggers. The catalog already maps feature → plugin → destination → route.

1. **Build time (data):**
   1. `packs.ts`: `tier: 'core' | 'daily' | 'power' | 'fleet'`, `reveal: readonly RevealTrigger[]`.
   2. `features.ts` onboarding block: optional `tier` override (e.g. pull a single Power feature into Daily), with
      valid and invalid schema cases in its test.
   3. Generated: `feature-catalog.ts` gains per-plugin `tier` (resolved, lowest across packs) so the client gate
      looks up `owner → tier` in O(1) without importing `packs.ts` logic.
2. **Runtime state (Host-owned):** it is about the user's adoption, not one window. The agent's
   `onboarding_overview` must report it, and a second browser must agree. It lives in the `dshfiles-onboarding`
   settings namespace (small) or a storage domain if `revealed` grows:

   ```ts
   disclosure: {
     mode: 'everything' | 'progressive',          // default 'everything' for existing profiles
     revealed: Record<PackId, { at: number; by: 'signal' | 'prerequisite' | 'event' | 'use' | 'user' }>,
     snoozed: Record<PackId, number>,             // until epoch ms
     dismissed: PackId[],
   }
   ```

   New profiles get `progressive` only when `FirstRun.setup` (`onboarding/src/first-run.ts`) returns `open`, i.e.
   no account or no project yet. Existing users keep everything visible. The new behaviour is opt-in for them,
   per the compatibility rule.

3. **Client gate (one provider, shell stays independent):**
   1. dshx defines a broker registry `dshx.visibility-gate`: `{ visible(owner, contributionId): boolean,
subscribe(listener) }`. `IsolationModel.isolate` wraps the contribution: when a gate exists and says hidden,
      it renders `null` but **stays registered**, so revealing needs no remount and keeps the order. With no gate
      registered, behaviour is identical to today.
   2. `@dshfiles/onboarding` is the only provider: owner package → resolved tier → `mode`/`revealed`. `frame-layout`
      contributes the zen predicate through the same registry (a second provider is fine if they AND together),
      or onboarding reads the zen seat. Pick one in review.
   3. `thread-sidebar` `Destinations.resolve` takes the same gate to drop hidden sections. A destination with no
      visible section leaves the rail, which meets the ade-ux "≤ 8, chosen from usage" budget dynamically.
   4. The palette is never gated. Its result rows for hidden features carry a "hidden" marker, and running one
      reveals the feature.
4. **Reveal writes:** one Host method `onboardingApi.reveal({ pack, by })` (+ `snooze`, `dismiss`, `setMode`), bound
   as an agent tool next to `onboarding_pack_apply`. That keeps agent parity: "show me the backlog" from chat reveals
   it. It is not a write the agent does on its own: like pack apply, it runs only on a user request.
5. **Event triggers:** owners already see their moments (jj-integration sees the first diff, agents sees a
   subagent). They emit a client `dshfiles:disclosure-event` CustomEvent (same pattern as `dshfiles:open-settings`,
   `settings-shell/src/open-settings.ts:9`). Onboarding listens, applies the trigger table and shows the nudge. Owners
   take no dependency on onboarding.

**Tests:**

1. `disclosure-model.test.ts`: tier resolution (lowest wins across packs; unpacked = core; infra excluded),
   trigger matching per kind, snooze expiry, dismissed never nudges, `use` reveal is idempotent, decode of a missing
   or old `disclosure` value → `everything`.
2. `catalog.test.ts` extension: every pack has a tier, every `usage` trigger names an existing `SUGGESTION_RULES`
   id, and every generated `owner → tier` entry agrees with `packs.ts` (staleness).
3. dshx `isolation.test`: a hidden contribution renders null, revealing re-renders **without remount** (mount
   counter, cf. `workbench.demoPanels` Ticker), and with no gate there is no behaviour change.
4. `frame-layout`: zen seat decode, the attribute set/removed, the layout math with zen collapses sidebar + right
   panel + strip and restores the previous widths, and the per-thread set is bounded.
5. E2E journeys (`dshx dev`, `reach`): (a) fresh progressive profile → rail shows Threads, Inbox, Settings only;
   seeded repository → Versioning appears; (b) palette runs a hidden Backlog command → Work destination appears and
   persists across reload; (c) zen toggle by chord → only transcript + composer, a question card still renders,
   leaving zen restores tabs; (d) phone width (`reachNarrow`).

### 3.4 (d) Risks

| Risk                                                                                                       | Likelihood    | Cost                                                                                | Mitigation                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------- | ------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hidden features never found                                                                                | high          | The power users this repo is for lose capability                                    | Palette never filtered; "Hidden for now" on Getting started; one click "Show everything" in Settings › Onboarding and in the palette; default `everything` for existing profiles    |
| Inconsistent state: a hidden plugin raises attention, a link opens a hidden panel, an agent says "click X" | medium        | Dead ends, confusing copy                                                           | Attention bypasses the gate and reveals; `openPanel`/`reach`/commands reveal on use; `onboarding_overview` reports `hidden` so the agent says "I can reveal it"                     |
| Gate in `IsolationModel` changes every contribution's render path                                          | medium        | Perf or remount regressions everywhere                                              | Gate absent = identical code path; O(1) map lookup per render behind one `useSyncExternalStore`; mount-count test                                                                   |
| Raw-slot surfaces (§2.3) ignore the gate                                                                   | certain       | Partial hiding looks random                                                         | D1 gates only rail sections (complete there); D2 only registry-based contributions; the raw list is tracked and migrated per owner, never patched with CSS selectors on foreign DOM |
| Zen hides something blocking (question, approval, quota)                                                   | medium        | A stalled thread nobody sees                                                        | `blocking` rows and question/approval cards are exempt; attention glyph count stays visible                                                                                         |
| Usage-driven rules silently never fire (suggestions off by default)                                        | high          | Power tier only appears by explicit opt-in                                          | Prerequisite + event triggers cover Daily and most Power; usage rules are a bonus, stated in the Hidden-for-now list ("turn on suggestions to get these offered")                   |
| Two browsers disagree                                                                                      | low           | Confusion                                                                           | Disclosure is Host-owned (agree). Zen is per window by design                                                                                                                       |
| Nudge fatigue                                                                                              | medium        | Users turn it all off                                                               | 1/day budget, idle-only, 30-day snooze, never during zen                                                                                                                            |
| P5b undecided: many UI plugins in no pack                                                                  | certain today | They are always visible (Core), so progressive mode shows less reduction than hoped | Fine as a safe default. Measure the visible rail/header count in progressive mode before claiming value                                                                             |

## 4. Phased plan

| Slice                     | Content                                                                                                                                                                                                                                                                                               | Size                               | Proof                                                                                                                |
| ------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Z1 (thin first slice)** | `frame-layout` zen seat + `data-dshfiles-zen` + `Zen mode` command/chord; hides sidebar column, right panel, status strip (frame-owned) and main tabs (workbench reads seat); browser-local state                                                                                                     | ~1 plugin + 1 small workbench read | Unit tests for seat and layout math; one E2E journey: chord → only centre column, reload keeps zen, chord → restores |
| Z2                        | Header pills (one owner: `ConversationSession.tsx`), `ComposerRow.blocking` + CSS rule, attention glyph, per-thread remember                                                                                                                                                                          | 3 owners                           | Question card still renders in zen (journey 3 fixture)                                                               |
| D1                        | `tier` + `reveal` on packs, `disclosure` Host state, `mode` setting (default `everything`; `progressive` for first-run), `reveal`/`snooze`/`dismiss`/`setMode` API + tool, rail sections gated in `thread-sidebar` `Destinations.resolve`, "Hidden for now" on Getting started, palette reveal-on-use | onboarding + thread-sidebar        | Fresh-profile journey (rail shrinks; palette reveals)                                                                |
| D2                        | dshx `visibility-gate` registry in `IsolationModel`; onboarding provider; zen predicate for composer pills/tools                                                                                                                                                                                      | dshx + onboarding                  | Mount-count test; no-gate parity                                                                                     |
| D3                        | Nudges: prerequisite + `SUGGESTION_RULES` triggers → empty states and idle ComposerRow; budget/snooze                                                                                                                                                                                                 | onboarding + owners' empty states  | Seeded usage journey shows exactly one nudge                                                                         |
| D4                        | Event triggers (`dshfiles:disclosure-event`) from jj-integration, pull-requests, agents, ai-accounts; migrate raw-slot surfaces (§2.3) to registries owner by owner; `features:check` requires a pack tier once P5b lands                                                                             | per owner                          | Per-owner journey                                                                                                    |

## 5. Open decisions

1. **P5b first?** Tiers on packs only cover what packs cover. Option A of P5b (packs + exemption list) is what
   this design assumes.
2. **Default mode for new profiles:** `progressive` only when the first-run wizard opens (proposed), or always
   `everything` with progressive as a pure opt-in.
3. **Zen chord:** `mod+shift+.` proposed. Needs a check against `@dshfiles/shortcuts` and native bindings.
4. **Zen scope:** global per window (proposed) with per-thread remember, or per thread only.
5. **Gate owner for zen predicate:** frame-layout provides its own gate entry vs onboarding reads the zen seat.
6. **Fleet auto-nudge:** keep the single "many subagents → Agents" rule, or make Fleet strictly opt-in.
