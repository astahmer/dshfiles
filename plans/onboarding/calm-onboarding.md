# Calm onboarding: setup outside, quiet inside

**As of:** 2026-11-12. Follows [README.md](README.md) (P1–P5a shipped). Packs are done and out of scope here except as the tier carrier.

**Resume here:** decisions taken (bottom). Nothing built yet; start with C1 + C2 + C4, Z1 and S1.

## Why

1. The original ask (`b:qrmm`, 2026-11-11) was a visual, interactive way to discover and toggle plugins, "even made externally (built in dshx? in the dshx cli serving a vite app maybe?) so it can even help to setup the dshfiles initially (when cloning the project from 0)". The external half was never put to a decision: it became a terminal `dshx init` picker that needs an already installed checkout ([1-original-decisions.md](research/1-original-decisions.md)).
2. Plan v0's best items were dropped without a decision in the v1 rewrite: the empty-thread hero card, one action on the empty states (ranked #1, cost S), and the "measure the wizard, then keep or demote it" gate ([0-plan-v0.md](research/0-plan-v0.md)).
3. Overwhelm is the user's own recorded complaint: backlog `m1nf` ("too much noise the UX becomes overwhelming"), `#55` (focus mode that hides most of the interface), `ftr2` ("only relevant stuff, no noise"). The onboarding work then added a page, a wizard, an overlay, What's new and suggestions on top.
4. Today a fresh profile gets 104 plugins on, about 35 rail sections, 78 settings entries, up to three stacked modals before the first prompt (an upstream DeepSeek Preview Notice, a DeepSeek sign-in, then a blocking wizard the plan said must be a non-modal card), Getting started buried 5th under Knowledge, raw `feat/fix` titles and package ids in the copy, and 66 of 81 empty states with no next action ([2-current-audit.md](research/2-current-audit.md)).
5. Evidence: upfront tutorials do not help (NN/g: 91% vs 94% task success), tours past 4 steps finish about 16% of the time, checklists finish about 19%; contextual hints at the moment of need, presets, detect-before-asking and core/optional tiers work ([4-external-patterns.md](research/4-external-patterns.md)).

## Principles

1. **Show less, don't load less.** Hiding is a UI decision; agent tools, attention, questions, approvals and quota blocks always work and always surface.
2. **Detect first, ask second.** Every screen opens on what was found, not on a question.
3. **One thing at a time.** No stacked modals, no tours longer than 3 steps, at most one nudge a day, never a toast, never in the Inbox.
4. **Teach where the user already is.** Empty states, the empty thread and the palette carry the teaching; the Getting started page is the index, not the entry point.
5. **The redesign's language, nothing new.** Dark Cockpit (colour only for Needs you and Failed), `Page → PageSection → EntityList → EmptyState`, one black primary, Sheet on phones, tokens only, sentence case, no taglines, no plugin names in labels ([3-redesign-language.md](research/3-redesign-language.md)).
6. **Measure, then keep or demote.** Success is "first thread done", not checklist completion.

## Workstreams

### C. Calm first run (inside DSH)

| Step | Work                                                                                                                                                                                          | Size |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| C1   | One first-run surface: hide the upstream DeepSeek Preview Notice on dshfiles profiles; the setup wizard becomes the non-modal card the plan promised (resumes at its step after a setup link) | S    |
| C2   | Empty-thread hero (v0 item, restored): one sentence plus at most 3 suggested first tasks, from the detected project                                                                           | S    |
| C3   | Empty states teach: a next action on the 15 most-seen empty states (v0's #1), one sentence each                                                                                               | M    |
| C4   | User-facing copy: What's new reads changes, not commit titles; no package ids or plugin names; feature rows show the benefit, not `currentSurface`                                            | S    |
| C5   | Getting started moves to the top of the rail while setup is incomplete, then folds into ⌘K and Knowledge                                                                                      | S    |
| C6   | Show me where walks repaired for the redesign (four walks still click a bare "Settings"; settle the phone path) and a test that resolves every `reach` start against the current shell        | M    |
| C7   | Visual gallery (accepted A9/A10, never built): a thumbnail per curated feature from the README screenshots, and a one-page cheat sheet                                                        | M    |

### Z. Zen mode

Owned by `frame-layout`, state per browser (`dshfiles.frame-layout.zen.v1`), a root attribute `data-dshfiles-zen`, never writes the owners' settings, so leaving restores the exact layout ([6-progressive-zen.md](research/6-progressive-zen.md)).

| Step | Work                                                                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Z1   | Zen seat, attribute, ⌘K command and chord: hides sidebar, right panel, status strip, main tabs; thread and composer stay                             |
| Z2   | Header pills, non-blocking composer rows (`ComposerRow` gains `blocking`) and the attention glyph hide; a blocking question or approval always shows |

### D. Progressive disclosure

Tiers ride on packs (`onboarding/src/packs.ts`): Core → Daily → Power → Fleet. A plugin in no pack stays visible. Existing users keep everything; a new profile starts in progressive mode.

| Step | Work                                                                                                                                                                                 |
| ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1   | Pack `tier` + Host state (`mode`, `revealed`, `snoozed`, `dismissed`) + reveal API and agent tool + rail filter + a "Hidden for now" list in Getting started + reveal on palette use |
| D2   | `dshx.visibility-gate` registry: hidden contributions render null but stay registered, so a reveal needs no remount                                                                  |
| D3   | Contextual offers at the moment of need (from the 7 existing usage rules + checklist facts), budget of one a day, in empty states or one row above the composer                      |
| D4   | Event triggers; migrate the raw `slots.inject` users to the gate                                                                                                                     |

### S. Setup outside DSH: `dshx setup`

A local web app served by the dshx CLI before DSH is set up ([5-configurator-design.md](research/5-configurator-design.md)).

1. 127.0.0.1 only, a one-time 256-bit token in the URL fragment, Host and Origin checked; endpoints `state`, `plan`, `apply` (streamed), `launch`, `shutdown`.
2. SPA in `tooling/dshx/packages/setup-ui` (Vite, plugin-ui primitives and the generated theme), copied prebuilt into dshx's dist, at most 250 KB gzipped, no data baked in: packs and features are read live from the checkout.
3. Writes reuse `ProfileInit.plan/apply` and `profile-sync --bundle`; never credentials, `accounts.json` or global installs.
4. Flow: **Check** (found: Node 24.11.1 from fnm, pnpm, jj/git, gh, logged-in agents, repos) → **Preset** (3–4 editable presets, each a plugin list) → **Review** (the exact files and plugins to change) → **Apply** (streamed, filtered build of the chosen plugins only) → **Launch** (start the checkout's `dsh`, catch its URL, hand off; the in-app card picks up account and project).
5. `--yes --preset <name>` runs the same plan with no browser.

| Step | Work                                                                                                 |
| ---- | ---------------------------------------------------------------------------------------------------- |
| S1   | Checks + presets + review + apply + printed start command, from a checkout                           |
| S2   | Filtered build + launch + handoff                                                                    |
| S3   | Project, key settings, account detection (presence only, env var names never values)                 |
| S4   | Reconfigure an existing install (same screens, diff against the live profile)                        |
| S5   | npm bootstrapper for "clone from zero" (needs a publish decision; `@dshfiles/dshx` is private today) |

### M. Measure

Local only: time from first boot to first finished thread, wizard completion and dismissal, reveals and their trigger. Decide after two weeks of use whether the card stays on by default.

## Order and slicing

1. C1 + C2 + C4 (one PR each, small, highest calm-per-line).
2. Z1, then S1 (independent; can run in parallel sessions).
3. C3, C5, C6.
4. D1 → D2 → D3; Z2; S2 → S3.
5. C7, D4, S4, S5, M.

## Decisions (2026-11-12)

1. P5b: option A, packs plus an explicit exemption list.
2. New profiles start progressive, unless `dshx setup` chose their plugins: then they show what was chosen. Existing users keep everything.
3. Zen: global per window, chord `mod+shift+.` (check against `@dshfiles/shortcuts` before shipping).
4. `dshx setup` writes a `main` profile; the seeded `web` profile stays "everything" (it resyncs to the seed before every start).
5. `onboarding` and `ai-accounts` join Core.
6. Launch writes `launcher.json`, so supervision and sync-before-start exist from day one.
7. S5 is in scope: publish a bootstrapper. `create-dshfiles` (`npm create dshfiles`) and `dshfiles` returned 404 on registry.npmjs.org on 2026-11-12, which means unpublished at check time, not reserved. Needs a publish workflow and an npm owner before the first release.
