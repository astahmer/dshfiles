# dshfiles onboarding: original vision, decisions, what was dropped

Read-only research, 2026-11-12. Sources: jj history of `~/dev/dshfiles` (read via `dshfiles-threads/freeze-fix`), the session-search index (`~/.dsh/plugins/session-search/index.sqlite`, opened read-only), the backlog DB (`~/.dsh/plugins/backlog/backlog.db`, opened read-only), and the CCD transcript search. No files in the repo were touched.

Coverage limits: the session index starts on 2026-10-09 and only holds DSH sessions. CCD transcripts had no relevant hit. Codex and other harness logs were not searched.

## 0. Timeline (all on 2026-11-11, UTC)

| Time           | Event                                                                                                                                                                                                                                  | Source                                                                                              |
| -------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 11:09          | The user creates backlog item **b:qrmm** (original wording below)                                                                                                                                                                      | backlog.db, item 679 `qrmm`                                                                         |
| 14:36          | The user asks for research and a plan only, with no code                                                                                                                                                                               | session-097f5604                                                                                    |
| 14:47 to 14:52 | Plan **v0** is written: `plans/onboarding/README.md`, revision `kwvysmxo` (commits `2297d80e`, then `ce0b40dc`); 6 open questions                                                                                                      | session-e7b5846e; that revision is no longer visible in the repo, but its full text is in the index |
| 14:58          | First set of answers from the user; the agent then proposes ideas A1 to A10                                                                                                                                                            | session-097f5604                                                                                    |
| 15:02 to 15:05 | Second and third sets of answers                                                                                                                                                                                                       | session-097f5604                                                                                    |
| 16:10          | Plan **v1**, "record onboarding decisions, packs and phases P1-P5", becomes the baseline                                                                                                                                               | commit `de6dabe114d3` (change `ztmlwopo`)                                                           |
| 15:59 to 20:49 | P1, P2, P3, P4 and P5a ship the same evening. Most of the work was delegated to subagents, and part of P2 ran on DeepSeek flash by mistake: at 17:13 the user wrote "i made a mistake i let deepseek work on it instead of you, opus". | commits `054cd00d` to `5078a775`                                                                    |
| 2026-11-12     | Only catalog regenerations; P5b still waits on a decision                                                                                                                                                                              | `be72e017`, `98dc075a`                                                                              |

## 1. The original ask (user's own words, b:qrmm, 2026-11-11 11:09)

Title: "guided tour of dshfiles / onboarding with interactive setup (see bb, t3code, opencode etc)"

Body, quoted:

> see what the common major harnesses do for the onboarding + also think of per plugin onboarding (maybe worth it or not idk) + we should have an interactive user friendly way of discovering everything (or the major stuff) that our dshfiles plugins offer, through screenshots/description etc where we can toggle some stuff or not and/or with live demos. this could either be internal (from dsh) or even made externally (built in dshx? in the dshx cli serving a vite app maybe?) so it can even help to setup the dshfiles initially (when cloning the project from 0)

The core intents in that body:

1. An interactive and visual way to discover the plugins: screenshots, descriptions, toggles, live demos.
2. An option to run it externally: the dshx CLI serving a Vite app.
3. Its purpose is to set up dshfiles from zero, right after cloning, before DSH runs.

## 2. Plan v0 (kwvysmxo, 14:47): a minimal and measured plan

1. **Phases:**
   1. P1: a catalog generated from the 110 `dshx.features.json` files, with a staleness test.
   2. P2: a gallery page with search, grouped by destination; the **Open** action appears only where a route exists.
   3. P3: a first-run wizard as one `settings.onboarding` step.
   4. P4: a **hero card** ("See what this setup can do", with tour and gallery buttons, dismissible) and **one action on about 15 empty states**.
   5. P5: agent parity and docs.
   6. P6: **measure first, then keep the wizard on by default or demote it**. This used browser-local counters (shown, finished, skipped at step N, hero dismissals). Its acceptance check: "A measured verdict in P6 says whether the wizard stays on by default."
2. **Ranked options.** The top two were "One action on ~15 P1 empty states" (cost S, value 3, "Cheapest real help") and "Hero entry-point card" (cost S, value 3).
3. **Deferred:** the "what's this" mode, the in-app what's new, screenshots, and a framework for per-plugin onboarding.
4. **Missing from v0:** the external or pre-setup Vite or dshx path from b:qrmm. The plan never discussed it.

## 3. User decisions (session-097f5604, 2026-11-11)

### 14:58, answers to the 6 v0 questions

> 1. new plugin 2. anyone! the point is both to make it easier to adopt/onboard on dshfiles + same for individual plugins (or a set of plugins) or even some features 3. non blocking; replayable stuff 4. new knowledge section + palette 5. that seems nice but im curious if u have other ideas? 6. ok for recommendation

### The agent's ideas A1 to A10

A1 packs, A2 a self-ticking checklist, A3 an `onboarding` block in each catalog, A4 Show me where, A5 What's new from jj, A6 suggestions from usage, A7 an agent-led demo, A8 **"Outside the app, for adopters: a `dshx init` interactive picker that composes a profile from packs, plus a generated docs page per pack, which could also feed dshmarket listings. This is the 'adopt dshfiles' path before anyone has the GUI."**, A9 small WebP thumbnails, A10 a generated cheat sheet.

### 15:02, answers on A1 to A10

> 1. yes 2. propose some & once we actually have everything mentioned & agreed on maybe we could even update the agents.md to make sure its self-healing/updating based on new plugins etc 3. ok 4. yes 5. yes; thats especially useful for people forking dshfiles! 6. ok 7. yes we want it 8. ok! 9. no

Answer 8 approved **including `dshx init` and the pack docs in this plan** instead of a separate plan. Answer 9 was to the question "anything to drop?", so nothing was dropped.

### 15:05

> 1. idk i feel like enabling a pack should install missing yes, wdyt? pick the best option 2. excellent 3. opus subagents 4. rename jujutsu workflow to "Versioning workflow" or somth not jj focused imo since these work for git as well

### What plan v1 recorded (de6dabe114d3)

1. A new `@dshfiles/onboarding` plugin, for anyone.
2. Non-blocking and replayable.
3. A **Knowledge › Getting started** page, plus palette entries and the New tab entry.
4. A wizard of 3 steps (account, project, first task) that inserts a prompt and never sends it.
5. Eight packs.
6. Phases:
   1. P1: catalog, gallery, read-only packs, checklist, wizard, `onboarding_overview`.
   2. P2: Enable/Disable pack and Show me where.
   3. P3: What's new and suggestions.
   4. P4: Try it, `dshx init`, docs per pack.
   5. P5: an AGENTS.md rule and the `features:check` gate.

## 4. What changed or was dropped

| Item                                                                                               | Origin                                     | Fate                                                                                                                                           | When and why                                                                                                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dshx CLI serving a Vite app for setup from a fresh clone, with screenshots, toggles and live demos | user, b:qrmm                               | **Never planned.** The research brief and plan v0 left it out. A8 replaced it with a **terminal** `@clack/prompts` multi-select (`dshx init`). | 14:36: the research brief listed tours, checklists, a "what's this" mode, a gallery and agent-led onboarding, but not the external app. No user message ever rejects the Vite idea. |
| Hero card in the empty thread view                                                                 | v0 P4, ranked #2                           | **Dropped** silently in v1. No `conversation.hero` code exists in the onboarding plugin.                                                       | v1 rewrite at 16:10 (`de6dabe1`). The user never decided it.                                                                                                                        |
| One action on about 15 empty states                                                                | v0 P4, **ranked #1**, "cheapest real help" | **Dropped** silently in v1. The plan still cites "64 of 77 empty states offer no next action" as a gap.                                        | Same rewrite                                                                                                                                                                        |
| P6: measure the wizard, then keep it or demote it                                                  | v0                                         | **Dropped.** It became P5, self-healing enforcement.                                                                                           | Same rewrite. The user did not ask for this change.                                                                                                                                 |
| Screenshots or thumbnails (A9), part of the original "screenshots/description" ask                 | user, b:qrmm                               | Kept but **unscheduled**. Not implemented. The gallery is text only.                                                                           | v1                                                                                                                                                                                  |
| Cheat sheet (A10)                                                                                  | agent                                      | Kept but **unscheduled**. Not implemented.                                                                                                     | v1                                                                                                                                                                                  |
| Toggles ("toggle some stuff or not")                                                               | user, b:qrmm                               | Became pack-level Enable/Disable with an exact preview (P2). There is no per-feature toggle.                                                   | 16:37                                                                                                                                                                               |
| Live demos                                                                                         | user, b:qrmm                               | Became "Try it": an agent thread, off by default because it spends tokens (P4a)                                                                | 19:39                                                                                                                                                                               |
| Wizard as a dialog                                                                                 | plan                                       | Became a non-modal top-right card, because a modal "is a gate in practice".                                                                    | P1 follow-up 2                                                                                                                                                                      |
| What's new built from history at build time                                                        | v1                                         | Switched to reading history on the Host at request time.                                                                                       | A build-time list would fail CI on unrelated commits.                                                                                                                               |
| A separate preview tool                                                                            | v1 P2                                      | Folded into `onboarding_overview`                                                                                                              | P2                                                                                                                                                                                  |
| P5b: every UI plugin in a pack                                                                     | user ("self-healing")                      | **Still open.** 52 UI plugins sit in no pack. The options are A (packs plus an exemption list), B (everything in Core) and C (drop the rule).  | Asked at 20:49. No answer is recorded.                                                                                                                                              |

### Scope growth

The v0 plan was 6 small phases with a measurement gate. v1 grew through A1 to A10: packs that install plugins, an overlay walk, What's new, usage suggestions, an agent demo, a CLI, docs, and a gate on every plugin. That came to about 85 onboarding blocks, 84 `reachNarrow` phone walks, 5 agent tools and 8 settings, all in one evening. The small "help where stuck" items (hero card and empty states) were lost along the way.

## 5. The pre-setup interactive configurator (Vite app in the dshx CLI)

1. **When it was raised:** 2026-11-11 11:09, in the b:qrmm body only. The phrase is: "built in dshx? in the dshx cli serving a vite app maybe? … help to setup the dshfiles initially (when cloning the project from 0)".
2. **Was it discussed?** No. Searches for "vite app", "configurator", "dshx setup", "setup ui", "before dsh" and "outside dsh" find no other user statement, in the session index or in the CCD transcripts. The only nearby agent framing is A8, quoted in section 3.
3. **What was decided:** A8, which the user approved with "8. ok!". It produced:
   1. `dshx init --profile <name> [--packs …] [--extend] [--yes] [--dry-run] [--json]`. Without `--packs` in a terminal, it shows a `@clack/prompts` multiselect with Core locked.
   2. It installs through the existing `profile-sync --bundle` path, the same as `dshx add`.
   3. It reads `plugins/@dshfiles/onboarding/src/packs.ts` from the **checkout** at run time.
   4. Docs per pack: `docs/packs/*.md`, with a `check:pack-docs` gate.
4. **Where it lives:**
   1. `tooling/dshx/packages/dshx/src/cli/init.ts` (158 lines)
   2. `tooling/dshx/packages/dshx/src/profile/init-profile.ts` (197 lines)
   3. `tooling/dshx/packages/dshx/tests/init-profile.spec.ts`
   4. `tooling/dshx/docs/cli-reference.md`
   5. Commits `ce42bf391159` (`jj:vlltwsss`) and `4cf62509340c` (`jj:uynuvtky`), 2026-11-11.
5. **Why it falls short of the vision:**
   1. It is a terminal multiselect of packs, not a visual Vite UI with screenshots, descriptions, toggles or demos.
   2. It needs an already-cloned, installed and built checkout (`packs.ts` is read from the checkout, and dshx must be built). So it does not cover setup from zero.
   3. Its interactive picker and booting a profile it composed are **unverified** (plan follow-up 13; final report at 20:49: "Unverified: … the interactive `dshx init` picker").
   4. It does not pre-configure accounts, projects or settings; those wait for the in-app wizard.
   5. There is no Vite, web or browser code in dshx for this.
6. **Why it stalled:** the planning brief turned the open question "internal or external Vite app?" into an in-app plan. A8 was then offered as a quick add-on for adopters, and the CLI picker was built in about 25 minutes by a subagent as part of P4b. Nobody went back to the Vite or pre-setup option. There is no record of a decision against it.

## 6. Statements on minimal UI, overwhelm, zen mode and progressive disclosure

1. **Backlog #55** (2026-10-19, todo): "Add a focus mode that hides most of the interface". Original note: "a 'focused' / 'zen' view without much UI (see tweet somewhere here)". Still todo.
2. **Backlog m1nf / #606** (2026-11-07, still in the inbox): "there's too much noise the UX becomes overwhelming" (with 3 screenshots).
3. **Backlog ftr2** (2026-11-06, dropped): "…only relevant stuff, no noise, kinda like an inbox" (activity timeline).
4. 2026-11-11 12:29, session-097f5604, on updates: "its not somth that i should have to think about much; updates should be coming in asap".
5. 2026-11-11 12:14, same session: "i shouldnt have to think about that tbh it should be auto".
6. 2026-11-09, session-55691328, phone setup: "we need a 1 click thing that just works. best DX possible"; "just works for anyone using dshfiles in 2mins"; "we should make it easy to install tailscale or cf … 1 click setup".
7. Related work, not an onboarding decision: PR #258, "quiet workbench redesign", merged on 2026-11-12 (`9c72bd629372`). It added a quieter transcript (Summary/Normal/Verbose) and moved the composer's extras into a ⋯ menu.
8. No statement uses "progressive disclosure" for the UI. The phrase appears only for tool-search (progressive tool discovery).
9. Contrast with what shipped: onboarding added a new page, a wizard card, an overlay, What's new and suggestions on top of an app the user had already called overwhelming four days earlier (m1nf). Nothing in the onboarding plan cites m1nf or #55.

## 7. Key artifacts

1. Plan v0 text, extracted: `0-plan-v0.md`. It comes from the session-e7b5846e write call; the revision itself is hidden or abandoned in jj.
2. Plan v1: `jj file show -r de6dabe114d3 plans/onboarding/README.md`
3. Current plan: `plans/onboarding/README.md` (392 lines; P5b open)
4. Decision transcript: session-097f5604-64fb-4c74-a34a-f11fc2b61b4e, 2026-11-11 14:36 to 15:12 UTC
5. Onboarding owner thread: session-e7b5846e-0a11-4ed1-a4d6-29e5b434a2e2
