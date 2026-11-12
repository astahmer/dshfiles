# External onboarding patterns for dshfiles

Scope: first-run experience of best-in-class dev and agent tools, progressive disclosure for plugin-heavy apps, CLI-launched local web wizards, and research evidence. Each pattern lists what it is, who does it well, why it works, when it fails, and how it maps to dshfiles (about 120 plugins and 560 features).

Confidence key: **[P]** primary source (vendor docs, vendor blog, peer-reviewed paper). **[S]** secondary source (teardown, vendor-benchmark data, community). Treat [S] as directional.

---

## 0. Evidence baseline (read this first)

1. **Upfront tutorials barely help and can hurt.** In NN/g's test (70 users, 4 apps), people who read deck-of-cards tutorials had 91% task success; those who skipped them had 94% (p=0.047). NN/g recommends contextual help, and pull revelations shown only during the relevant activity (its example is Figma). Walkthroughs remain useful only for a genuinely novel interaction model. [P] https://www.nngroup.com/articles/mobile-tutorials/ , https://www.nngroup.com/articles/onboarding-tutorials/
2. **Tours decay fast with length, and work better when the user starts them.** In Chameleon's data, 3–4-step tours complete about 72–74% of the time and 7+ step tours about 16%; the 2024 report shows 5-step tours dropping to 21.6%. Tours the user clicks to start complete at 67%, against 31% for tours fired after a delay. [S, vendor data] https://www.chameleon.io/benchmark-report , https://www.chameleon.io/benchmark-report-24
3. **Checklists are mostly unfinished, and that is fine.** Userpilot (188 companies) reports average checklist completion of 19.2% (median 10.1%), while average activation is about 37.5%. Users reach value without ticking every box, so measure activation, not checklist completion. [S, vendor data] https://userpilot.com/blog/saas-onboarding-benchmarks/ , https://userpilot.com/blog/user-onboarding-metrics/
4. **Choice overload is conditional, and DSH new users meet every condition.** The meta-analysis of 50 experiments (N=5,036) found a mean effect near zero (Scheibehenne et al. 2010). Chernev et al. (2015) identify four moderators: choice-set complexity, task difficulty, preference uncertainty, and the decision goal. A first-time DSH user picking from 120 plugins faces high complexity, does not yet know what they want, and wants to "just start", so all four apply. [P] https://abcwest.cogs.indiana.edu/pmwiki/pdf/scheibehenne.options.2010.pdf , moderators summarized in https://www.frontiersin.org/articles/10.3389/fpsyg.2022.800528
5. **Progressive and staged disclosure are different tools.** Progressive disclosure shows a few important options first and defers the rest; you must get the split right. Staged disclosure is a linear wizard, and it breaks when steps depend on each other and users have to bounce between them. [P] https://www.nngroup.com/articles/progressive-disclosure/
6. **Large plugin ecosystems overwhelm users, by their own account.** On the Obsidian forum (8,255 plugins, Sep 2026), users report a "sad and overwhelmed" feeling and worry about safety and abandonment. The remedies they propose are a tiered "main vs community" repo (Alpine-style), replacing plugins with core features, and keeping a short essentials list. [S, community] https://forum.obsidian.md/t/there-are-8-255-plugins-as-of-2026-09-30-feeling-sad-and-overwhelmed/118891

**Takeaway for dshfiles:** do not build a long tour. Ship a small default, let users pull in the rest, teach in context, and judge success by "first agent thread finished", not by setup steps completed.

---

## A. First-run patterns

### A1. One central decision, everything else skippable

1. **What:** first run asks exactly one consequential question, and every other step has an explicit Skip.
2. **Who:** Raycast's first decision is the global hotkey; optional screens carry Skip, and there is a separate migration flow for existing users. [P] https://manual.raycast.com/windows/getting-started , https://www.raycast.com/changelog/macos-beta
3. **Why it works:** the one decision the product cannot function without is made deliberately. Everything else defaults.
4. **When it fails:** when the "one" decision is actually several decisions hidden inside a form.
5. **dshfiles:** the central decision is **which agent/provider account to use** (Claude Code, Codex, and so on). Everything else, including jj vs git, backlog, inbox and themes, gets a default and a Skip.

### A2. Import before you ask

1. **What:** detect existing setup and offer one-click import, instead of asking questions.
2. **Who:**
   1. Zed imports VS Code settings and lets you choose a base keymap during onboarding; both can be re-run later from the command palette. [P] https://zed.dev/docs/migrate/vs-code
   2. Cursor does a one-click VS Code import. [P/S] https://docs.cursor.com/get-started/installation
   3. Arc imports browser data, with defaults pre-selected. [S] https://uxdesign.cc/why-the-arc-browser-is-the-chrome-replacement-ive-been-waiting-for-1e0a05da9fc9
3. **Why it works:** it turns questions into confirmations, and familiar data makes the new UI feel owned.
4. **When it fails:** a partial import that is silently lossy. Zed says outright that it does not import extensions or keybindings.
5. **dshfiles:** before asking anything, detect what is already there:
   1. `~/.claude`, `~/.codex` and opencode auth.
   2. Whether `jj` or `git` is on PATH and the repo is colocated.
   3. Existing MCP configs, AGENTS.md and CLAUDE.md, and skills dirs.

   Show these as pre-checked rows ("Found: Claude Code (logged in), jj 0.x, 3 repos"). Say plainly what is not imported.

### A3. Learn on real work, not a demo

1. **What:** onboarding tasks appear as real objects in the user's own workspace.
2. **Who:** Linear puts onboarding items as issues in your own queue, keeps the flow very short (no role or permission setup), and introduces the command menu early. [S] https://www.candu.ai/blog/linear-onboarding-teardown , https://www.appcues.com/blog/the-10-best-user-onboarding-experiences. Linear's own start guide also offers a demo workspace. [P] https://linear.app/docs/start-guide
3. **Why it works:** zero transfer cost, because the lesson is the work.
4. **When it fails:** seeded items that look like spam or never go away.
5. **dshfiles:** seed 3 **backlog items** (or inbox items) in the user's actual DSH, each completable in under a minute:
   1. "Start a thread in <detected repo>".
   2. "Run /something with a subagent".
   3. "Open the command palette".

   Each one completes when the action happens, and they are deletable in bulk.

### A4. Welcome block plus persistent resource center (not a modal)

1. **What:** the first screen is an inline welcome element that points to a resource center that stays available, with a short checklist.
2. **Who:** Warp ("Onboarding 2.0") added a welcome block plus a resource center holding a gamified Getting Started checklist. It also made login optional in 2025. [P] https://www.warp.dev/blog/driving-user-activation. Note that Warp published no numbers on the impact.
3. **Why it works:** it lives in the product's own primitive (a block), and the user can come back to it.
4. **When it fails:** a checklist that becomes permanent clutter. Make it dismissible and have it auto-retire.
5. **dshfiles:** the empty thread list _is_ the welcome block. The resource center is one panel listing "what's on / what's available", and the checklist (from A3) lives there.

### A5. Human-led first, then codify

1. **What:** run onboarding by hand for the first N users, then turn what you learned into the product.
2. **Who:** Superhuman ran 30-minute 1:1 sessions focused on outcomes (Inbox Zero, keyboard shortcuts), then moved those learnings in-product and went self-serve. [P/S] https://review.firstround.com/inside-superhumans-onboarding-strategy-from-human-led-to-self-serve/ , https://blog.superhuman.com/the-fastest-way-to-inbox-zero-a-single-coaching-session/
3. **Why it works:** it finds the real activation moment before anyone designs UI for it.
4. **When it fails:** it does not scale, and it is costly if never codified.
5. **dshfiles:** watch 3–5 people install dshfiles cold before building the configurator. Record where they stall: provider auth, jj, plugin choice.

### A6. Trust and safety gate as an explicit first-run step

1. **What:** first run asks for an explicit trust decision before anything executes.
2. **Who:**
   1. Claude Code shows a workspace trust dialog on first use in a directory. [S] https://frontendmasters.com/courses/pro-ai/getting-started-with-claude-code
   2. Obsidian runs in Restricted mode (formerly Safe mode), where all community plugins are ignored until the user opts in; core plugins stay on. [P] https://obsidian.md/help/plugin-security , https://obsidian.md/help/community-plugins
3. **Why it works:** risk is named once, at the right moment, and the safe default is usable.
4. **When it fails:** when the gate feels like friction with no explanation, or when the safe mode is unusable.
5. **dshfiles:** plugins that spawn processes, touch remote services or rewrite VCS history get a **"powerful" badge** and stay off until enabled. Provide a `--safe` boot that loads only core plugins, which doubles as the recovery path when a plugin breaks the UI.

### A7. Personalize by intent, then pick a preset

1. **What:** ask "what will you use this for", then pre-select templates or profiles.
2. **Who:**
   1. VS Code profile templates (Python, Data Science, and others) install curated extensions and settings in one step. [P] https://code.visualstudio.com/docs/configure/profiles
   2. Notion's use-case question shapes the starter templates. [S, sources conflict] https://www.candu.ai/blog/how-notion-crafts-a-personalized-onboarding-experience-6-lessons-to-guide-new-users
3. **Why it works:** it collapses N choices into one intent choice, which addresses the preference-uncertainty moderator (§0.4).
4. **When it fails:** too many personas, or presets that cannot be inspected or diffed.
5. **dshfiles:** offer 3–4 **presets** ("Solo + Claude Code", "Multi-agent + jj", "Team backlog/inbox", "Minimal"). Each one is just a list of plugin ids, so it can be shown as a diff and edited.

### A8. Built-in sample data so the first screen is not empty

1. **What:** a zero-config data source lets users see value before connecting anything.
2. **Who:** Grafana's built-in `-- Grafana --` data source produces a Random Walk series for a first dashboard. [P] https://grafana.com/docs/grafana/latest/getting-started/getting-started
3. **Why it works:** time to first value no longer depends on external setup.
4. **When it fails:** fake data that gets mistaken for real data, or that never leaves.
5. **dshfiles:** a "sandbox repo" option (a temp jj repo) so a user without provider auth or a chosen repo can still try a thread or subagent UI. Label it clearly as a sandbox.

### A9. A first-user screen that cannot lock you out

1. **What:** a fresh install routes to a create-first-admin screen.
2. **Who:** Payload's `/admin/create-first-user`. The known pitfall: a required relationship field on that form, with no related records yet, leaves the user stuck. [S, community] https://github.com/payloadcms/payload/discussions/993
3. **dshfiles:** no first-run step may require data that only a later step creates. For example, do not require "pick a backlog project" before any project exists.

---

## B. Progressive disclosure for plugin-heavy apps

### B1. Core vs community tiers

1. **What:** core and community plugins are explicitly separated.
2. **Who:** Obsidian (core plugins maintained by the team, most of them on by default; community plugins behind Restricted mode). [P] https://obsidian.md/help/community-plugins. The community is now asking for Alpine-style main/community tiers. [S] (§0.6)
3. **Why it works:** the default set is supportable, and trust grows step by step.
4. **When it fails:** when a core feature is missing and everyone needs the same three community plugins. Then promote them.
5. **dshfiles:** label every plugin with one tier: **core** (on, cannot be removed), **recommended** (on in the preset), **optional**, **experimental**. Show about 15 plugins on first run, not 120.

### B2. Contributed, per-plugin walkthroughs that complete on events

1. **What:** each extension contributes a short "Get Started" walkthrough. Steps are verb-led, carry media, and complete themselves on events.
2. **Who:** VS Code `contributes.walkthroughs`. Its UX guidelines say: give every step an action that starts with a verb, use theme-aware SVGs, avoid an excessive number of steps, and do not ship multiple walkthroughs unless you need to. [P] https://code.visualstudio.com/api/ux-guidelines/walkthroughs , https://code.visualstudio.com/api/references/contribution-points#contributes.walkthroughs
3. **Why it works:** onboarding scales with the plugin count without a central team owning it, and the walkthrough appears only once the plugin is enabled.
4. **When it fails:** 30 extensions each pushing a walkthrough on install. Keep them pull-only.
5. **dshfiles:** add an optional `onboarding: [{ title, action (command id), doneWhen (event) }]` field to the plugin manifest, capped at 3 steps. Steps surface in the resource center only after the plugin is enabled.

### B3. Pull revelations (contextual hints triggered by activity)

1. **What:** a tip appears only when the user is doing the related thing.
2. **Who:** Figma, as cited by NN/g. [P] https://www.nngroup.com/articles/onboarding-tutorials/
3. **Why it works:** the help arrives when the user needs it, and the evidence in §0.1–0.2 supports this over upfront tours.
4. **When it fails:** too many hints. Rate-limit to one per session.
5. **dshfiles:** examples:
   1. The first time a user opens a subagent, show "tip: you can fork".
   2. The first time a jj conflict appears, show the conflict plugin's hint.

   Hints come from the plugin manifest and are shown at most once each.

### B4. Interactive lessons in a sandbox, opt-in from a "Learn" tab

1. **What:** a separate tab holds interactive lessons that run in a scratch project, each completed by doing the real action.
2. **Who:** the JetBrains IDE Features Trainer: a Learn tab on the Welcome screen, an onboarding tour as the first lesson, and lessons made of tasks you must perform, with resettable progress. [P] https://www.jetbrains.com/help/idea/feature-trainer.html
3. **Why it works:** it is opt-in (the user starts it, which per §0.2 gets 67% completion), and learning happens by doing.
4. **When it fails:** when it is the only discovery path.
5. **dshfiles:** a "Learn" section that uses the sandbox repo (A8) for multi-step concepts: worktrees, subagents, rewriting jj history.

### B5. Command palette as the discovery surface

1. **What:** everything can be found by name, including disabled features.
2. **Who:**
   1. Linear introduces the command menu during onboarding. [S] https://supademo.com/content/plg-onboarding-gallery/linear
   2. Zed brings Welcome and Import back through the palette. [P] https://zed.dev/docs/getting-started.md
3. **Why it works:** zero UI cost for features that are not enabled.
4. **When it fails:** when results are not ranked, or when disabled entries look broken.
5. **dshfiles:** palette results include **disabled plugin features** labeled "Enable <plugin> to use". This becomes the unlock-on-demand path: enabling happens in place, then the action runs. It replaces "browse 560 features".

### B6. Default-minimal plus focus modes

1. **What:** ship with the minimal UI and opt into density; offer a one-key focus/zen mode.
2. **Who:** VS Code Zen Mode and profiles [P] https://code.visualstudio.com/docs/configure/profiles. Zed's welcome page offers only open folder, clone and docs, and disappears once a folder or file is open. [P] https://zed.dev/docs/getting-started.md
3. **dshfiles:** the first-run shell shows the threads list and composer only. Panels such as backlog, inbox and model accounts appear when their plugin is enabled, or after first use.

### B7. Unlock over time / usage-surfaced features

1. **What:** suggest the next feature once a usage threshold is reached ("you've run 5 threads, try subagents").
2. **Who:** this pattern is common in onboarding tooling, but I found no strong primary source for a specific dev tool doing it well. Treat it as a hypothesis.
3. **When it fails:** it feels patronizing to experts, so always allow "show everything".
4. **dshfiles:** one weekly "you might like" card based on local usage counters, with no telemetry sent anywhere.

---

## C. CLI-launched local web setup apps

### C1. Prebuilt static bundle served by the CLI, with a live channel

1. **What:** the npm package ships a prebuilt SPA; the CLI serves it from `dist` on localhost and talks to it over WebSocket.
2. **Who:** Vitest UI (`vitest --ui`): a Vite plugin serves the built Vue client from dist at `/__vitest__/` and sends live updates over WebSocket. The docs warn not to expose the UI server to the network. A known failure is a missing `xdg-open` in containers. [P] https://vitest.dev/guide/ui , https://main.vitest.dev/config/ui
3. **Why it works:** there is no build at install time, and the UI is a pure view over CLI state.
4. **When it fails:** a headless or SSH box with no browser.
5. **dshfiles:** `dsh setup` serves a prebuilt configurator bundle from the package. Bind to `127.0.0.1` only. Print the URL as well as auto-opening it, so a failed `xdg-open` does not block setup.

### C2. Token-in-URL auth, then cookie

1. **What:** the CLI prints a URL with a one-time token; the browser exchanges it for a cookie.
2. **Who:** Jupyter Server generates a token and prints a tokenized URL. It uses an extra token when it launches the browser itself, sets a cookie after the first visit, and lists running servers and their URLs with `jupyter server list`. [P] https://jupyter-server.readthedocs.io/en/stable/operators/security.html
3. **Why it works:** it stops other local processes and sites from driving the setup API (CSRF and DNS rebinding), at no cost to the user.
4. **When it fails:** a token URL pasted into chat or logs is a credential.
5. **dshfiles:** a one-shot launch token is exchanged for an httpOnly cookie, and the token is stripped from the URL right away. Check the Host/Origin header. Add `dsh setup --print-url` for recovery.

### C3. Print URL plus QR for "browser elsewhere"

1. **What:** when no browser is reachable locally, print a URL and a QR code.
2. **Who:** `tailscale up` prints a login URL, and `--qr` renders it as a QR code. Auth keys skip the browser entirely. [P] https://tailscale.com/kb/1241/tailscale-up
3. **dshfiles:** for SSH or remote DSH hosts, print the URL plus an optional QR code, plus a fully non-interactive path (`dsh setup --preset minimal --yes`) for the case where no browser is available.

### C4. Schema-driven forms with dry-run preview

1. **What:** a generic UI renders forms from a schema and previews the effect before applying.
2. **Who:** Nx Console Generate UI parses any generator's schema and offers autocomplete, validation and **dry-run previews as you type**. [P] https://nx.dev/docs/guides/nx-console/console-generate-command.md , https://nx.dev/blog/nx-console-gets-lit
3. **Why it works:** one UI covers N plugins, and the dry run builds trust because nothing is written blind.
4. **When it fails:** generic forms for things that need bespoke UX, such as OAuth.
5. **dshfiles:** the configurator renders each plugin's config from its manifest schema (Effect Schema → JSON Schema), and the final step shows the **diff of files to be written**: settings, MCP config, skills. The CLI writes them only after confirmation.

### C5. CLI init that hands off to an in-app tour

1. **What:** the scaffolder finishes by launching the app, which starts a short tour on first boot.
2. **Who:** Storybook 7.1+: after `storybook init` in a new React project, a guided in-app tour shows how the UI fits together and walks through writing the first story. [P] https://storybook.js.org/blog/in-app-tour-for-new-users
3. **dshfiles:** the configurator's last screen hands off to DSH, starting it and opening the URL, and that boot lands on the A4 welcome block with the A3 seeded tasks. The CLI writes a `firstRun` marker so the tour fires once.

### C6. Discovery-driven setup flows per integration

1. **What:** each integration declares a config flow, and the core discovers devices and offers "configure" cards.
2. **Who:** Home Assistant:
   1. Onboarding is 5 steps and ends on the discovered devices. [P] https://www.home-assistant.io/getting-started/onboarding/
   2. Integrations declare `config_flow: true` and implement `async_step_user` plus discovery steps (`async_step_zeroconf`, `async_step_dhcp`, …). [P] https://developers.home-assistant.io/docs/core/integration/config_flow
3. **Why it works:** core onboarding stays tiny while integrations scale independently, and setup is offered only for what the system actually found.
4. **When it fails:** noisy discovery, with lots of "configure?" prompts.
5. **dshfiles:** this is the closest analog. Each plugin may export `detect()` (for example, finds `~/.codex`, a `.jj` dir, a Linear token env var) and a `setup` flow of 1–3 steps. The configurator shows "Detected: 4 plugins ready to enable" first, and everything else under "Browse".

### C7. Provider auth is a prerequisite: detect, do not re-implement

1. **What:** agent GUIs depend on CLI providers being installed and logged in.
2. **Who:**
   1. T3 Code: install and authenticate at least one provider (Codex or Claude login in a terminal) first. [S] https://betterstack.com/community/guides/ai/t3-code/
   2. Conductor runs first-party Claude Code, Codex, Cursor and OpenCode with existing subscriptions, and has fixed an onboarding hang during Claude Code auth. [S] https://www.conductor.build/changelog/page/8
3. **When it fails:** auth hangs inside the wizard with no escape.
4. **dshfiles:** the configurator checks each provider's logged-in state and, when it is missing, shows the exact command plus a "re-check" button. It never embeds the provider's own login flow, and it always has a timeout and a Skip.

---

## D. "Steal this", ranked by impact/effort

| #   | Idea                                                                                                                                                                                    | Impact                            | Effort   | Source pattern   |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------- | -------- | ---------------- |
| 1   | **Detect first, ask second.** The configurator opens on "Found: Claude Code (logged in), jj, 3 repos → 6 plugins ready", with a one-click enable.                                       | High                              | Low–Med  | A2, C6, C7       |
| 2   | **3–4 presets as editable plugin-id lists**, with a diff preview of the files to be written before applying.                                                                            | High                              | Low      | A7, C4           |
| 3   | **Tiered catalog (core / recommended / optional / experimental)**, so first run shows about 15 plugins. Powerful plugins stay off until opted into, plus a `--safe` boot.               | High                              | Med      | B1, A6           |
| 4   | **Command palette lists disabled features with an "Enable & run" action.** Unlock on demand instead of browsing 560 features.                                                           | High                              | Med      | B5               |
| 5   | **Seeded real backlog items (3, under a minute each, auto-completing on events)** instead of a tour. Measure "first thread done", not checklist completion.                             | Med–High                          | Low      | A3, A4, §0.1–0.3 |
| 6   | **Configurator served as a prebuilt bundle on 127.0.0.1 with a one-shot token→cookie**, printed URL plus `--print-url`/QR, and a `--yes --preset` headless path.                        | Med (makes setup possible at all) | Low      | C1–C3            |
| 7   | **Manifest-contributed micro-onboarding** (at most 3 verb-led steps plus at most one contextual hint per plugin), shown only after the plugin is enabled, at most one hint per session. | Med                               | Med      | B2, B3           |
| 8   | **Sandbox repo plus an opt-in "Learn" section** for multi-step concepts (subagents, worktrees, jj rewrites).                                                                            | Med                               | Med–High | A8, B4           |

Anti-patterns to avoid, with evidence:

1. Tours longer than 4 steps (§0.2).
2. Tours fired on a timer (§0.2).
3. Showing the full 120-plugin catalog first (§0.4, §0.6).
4. Wizard steps that depend on later steps (§0.5, A9).
5. Judging onboarding by checklist completion (§0.3).

## Gaps and caveats

1. Some sources could not be confirmed at primary level:
   1. Linear, Notion and Arc onboarding details come from teardowns.
   2. Warp published no impact numbers.
   3. I found no official first-run docs for the Codex app, Conductor, OpenCode or T3 Code; details are secondhand.
   4. The Claude Code trust dialog is described only by third parties in these results.
2. Tour and checklist benchmarks come from onboarding vendors (Chameleon, Userpilot). They are directional, not independent.
3. Not covered in depth: Docker Desktop, Ollama/LM Studio, Prisma Studio, Strapi first-run, Figma beyond the NN/g citation, the Claude desktop app, and Raycast extension-store curation.
