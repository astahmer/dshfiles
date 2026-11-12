# Pre-setup configurator (`dshx setup`) — research + design

Repo: `~/dev/dshfiles-threads/freeze-fix` (read-only investigation, 2026-11-12). Paths below are repo-relative.

## 0. TL;DR

1. Nearly all the write logic already exists headless: `ProfileInit.apply` (`tooling/dshx/packages/dshx/src/profile/init-profile.ts`) composes a profile from packs with a dry-run plan, through `scripts/profile-sync.ts --bundle`. The configurator is a **UI over that plan/apply**, plus env checks, a build step, an optional project registration and a launch/handoff. No new reconciler.
2. **`npx dshx setup` is not possible today.** `@dshfiles/dshx` is `private: true`, the fork deleted all publishing (`tooling/dshx/FORK.md:34-40`), `DSHFILES_ROOT` is computed from the dist file's location (`src/project/local-bundles.ts:16`), and every owned plugin is linked into a profile as `link:<checkout>/plugins/@dshfiles/<name>`. A profile cannot exist without a checkout. So: **phase 1 runs from a checkout** (`pnpm setup` → `dshx setup`); an `npx` bootstrapper that clones + installs and then execs the in-checkout configurator is a later, separate phase.
3. Architecture: `dshx setup` starts a loopback `node:http` server (random port, 256-bit token, Host/Origin checks), serves a prebuilt Vite SPA, exposes 5 JSON endpoints (`state`, `plan`, `apply`, `launch`, `shutdown`), streams apply progress, then hands off by starting DSH and opening its own tokenized URL. The in-app onboarding wizard then takes over (it auto-opens while an account is missing: `plugins/@dshfiles/onboarding/src/first-run.ts`).
4. Credentials are never entered in the configurator. Accounts step is detect-and-explain only; real sign-in stays in AI Accounts inside DSH (Host-only credential controller).
5. Thin first slice ≈ checks + packs + review + apply + "run this to start" — all built on `ProfileInit` and `--dry-run`, testable in a temp `DSH_HOME`.

## 1. What exists

### 1.1 dshx CLI

| Piece                     | Where                                                                                                                                                                                                   | Reuse                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| bin entry                 | `packages/dshx/package.json` `bin.dshx → dist/cli/bin.js`; `src/cli/bin.ts` → `runCli` (`src/cli/run.ts`)                                                                                               | add a `setup` subcommand in the same dispatcher                                                                                                                                                                                                                                                                                                               |
| build                     | `tsc -p tsconfig.build.json && copy-ambient.mjs && publish-runtime-store.mjs` (5.2 MB dist). Vite is already a runtime dependency (plugin builds)                                                       | add a copy step for the SPA dist, like `copy-ambient`                                                                                                                                                                                                                                                                                                         |
| `dshx init`               | `src/cli/init.ts` (clack multiselect, `--profile --packs --extend --yes --dry-run --json --home`), `src/profile/init-profile.ts`                                                                        | **core reuse**: `ProfileInit.loadPacks()` + `ProfileInit.apply({catalog, packs, profile, dshHome, extend, dryRun})` returns `InitProfilePlan` (plugins, suppliers, kept, created, commands, files, restart). Errors are typed (`PackSelectionError` → exit 2, `ProfilePluginError` with `hint`)                                                               |
| packs loading             | `init-profile.ts:16-47` reads `plugins/@dshfiles/onboarding/src/packs.ts` from the checkout at run time via strip-types import, decoded with an Effect Schema (dshx cannot depend on onboarding: cycle) | same loader for the server; decodes only id/title/summary/core/plugins (prerequisites, keySettings are dropped by the schema — extend the schema, not a new loader)                                                                                                                                                                                           |
| `dshx add`                | `src/profile/add-plugin.ts` (`ProfilePlugins.addOwned`, `profileRoot`, `readBundles`, `ownedSyncCommand`, `--option key=value` row merge into `cordis.patch.yml`, `RESTART_HOST`)                       | key-settings writes go through the same row-merge, never a hand-written YAML edit                                                                                                                                                                                                                                                                             |
| `dshx checkout sync/plan` | `src/cli/checkout.ts`, `src/checkout/{sync,rebuild}.ts`                                                                                                                                                 | its rebuild logic ("rebuild dshx and plugins whose sources changed + dependants") is the model for the build step                                                                                                                                                                                                                                             |
| `dshx dev up/open`        | `src/scratch/up.ts` (+ `cli-reference.md:72-90`)                                                                                                                                                        | `URL_PATTERN` + `waitFor` launch-URL capture from the Host log (`up.ts:44, 257-305`), `resolveDshExecutable` (checkout `node_modules/.bin/dsh` before PATH, `src/project/dsh-executable.ts`), `findFreePort`, `registerScratchWorkspace` (workspace-v2 storage, `wx` = never overwrite, `src/project/scratch-workspace.ts`), `ScratchStateRuntime.redactUrls` |
| `create-dshx`             | `packages/create-dshx`                                                                                                                                                                                  | plugin **scaffolder**; do not overload it with user setup                                                                                                                                                                                                                                                                                                     |
| runtime-store             | `packages/dshx/runtime-store/*`                                                                                                                                                                         | unrelated to setup                                                                                                                                                                                                                                                                                                                                            |

### 1.2 Profile reconcile

1. `scripts/profile-sync.ts` is "the single reconciler" (header comment; `AGENTS.md` §Profiles 2). Seeded profile (`profiles/<name>/` exists) ⇒ `@dshfiles/*` rows become **exactly the seed's**; `--bundle` bypasses the seed and only adds (`profile-sync.ts:442`). It warns but does not build stale/unbuilt linked bundles (`:430-447`).
2. `profiles/web/` seed: full owned set (`package.json`), `cordis.patch.yml` with load-bearing rows (connection inject fix, session-query disable, …), empty `ai-accounts.json`.
3. `docs/profile-installs.md`: `pnpm add <path>` is blocked; `link:` + `pnpm install`; `autoInstallPeers: false` must stay; public `@deepseek-ai/*` npm line is an older generation.
4. `docs/personal-configuration.md`: launcher config at `${XDG_CONFIG_HOME:-~/.config}/dshfiles/launcher.json` (mode 0600, no credentials; keys `sourceRoot dshHome nodeBinary coreEntry profile …`); "A fresh installation should seed its writable web profile with the existing profile reconciler, then configure accounts and explicitly select a model." Launcher refuses when a Host already serves that home+profile (`scripts/running-hosts.mjs`).

### 1.3 Onboarding plugin (`plugins/@dshfiles/onboarding`)

| Piece                                                      | File                                                                                                                                                    | Headless?                                                                                                                                                             |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pack definitions (8 packs, `prerequisites`, `keySettings`) | `src/packs.ts`                                                                                                                                          | yes — plain data, already loaded by dshx                                                                                                                              |
| Feature catalog (500 features, 110 plugins)                | `src/generated/feature-catalog.ts` (**991 KB**), generator `scripts/generate-catalog.ts` (reads `dshx.features.json` + package descriptions; `--check`) | data yes; too big to ship whole — project a slim view                                                                                                                 |
| Curation rule                                              | `src/curation.ts` (`curationOf`, shared with `scripts/pack-docs.ts`)                                                                                    | yes                                                                                                                                                                   |
| Pack plan/apply                                            | `src/pack-plan.ts` (`PackPreview`: install/change/fine/kept/blocked/prerequisites/restart), `pack-change-flow.ts`, `plugin-manager-promise.ts`          | **no** — reads the live plugin manager; pre-setup has no Host. Reuse the _preview vocabulary_ (install / kept / restart) in the UI, compute it from `InitProfilePlan` |
| Checklist facts                                            | `src/setup-facts.ts` (accounts via AI accounts Host API, workspace registry, `gh auth status` cached 60 s)                                              | `github-auth.ts` (`checkGithubAuth`) is reusable; account/project facts need Host — re-derive from files read-only                                                    |
| First-run wizard                                           | `src/first-run.ts`, `setup-wizard.tsx` (Account → Project → First task; non-modal; opens while `account/project/repository` not done)                   | handoff target                                                                                                                                                        |
| Try it                                                     | `try-it-*.ts` (off by default, spends tokens)                                                                                                           | not in pre-setup                                                                                                                                                      |
| Checkout locator                                           | `src/dshfiles-checkout.ts` (from the bundle's `link:` source)                                                                                           | confirms the link-to-checkout model                                                                                                                                   |

### 1.4 Prior discussion

1. `plans/onboarding/README.md` A8 "**Outside the app** — `dshx init` interactive profile composer from packs" (P4, done, `jj:vlltwsss`); follow-up 13: "Its interactive terminal picker and booting a composed profile are unverified; `--yes`, `--dry-run` and `--json` ran in a temp home."
2. No "configurator", "init --ui", "dshx setup" or Vite setup app anywhere in `plans/`, `docs/`, `tooling/dshx/docs` or jj descriptions (`description(glob-i:"*init*")`). The only related history: `vlltwsss feat(dshx): compose a profile from onboarding packs with dshx init`, `uynuvtky docs(packs): …`, `zswourpz docs(plans): record dshx init …`, `squtsrwr feat(workspace-folder-picker): inspect a folder and offer Jujutsu before adding it`.
3. Competitor note in the plan: t3code `FirstRunGate` → Connect → Agents → Projects; lesson recorded: "every step ends in an action that cannot dead-end … the wizard should _route_ to [owner surfaces], not reimplement them" — applies here too.

### 1.5 Design system

1. `plugins/@dshfiles/plugin-ui/src/components/ui/*` — shadcn-style (radix-ui, cva, lucide, Tailwind 4, `lib/utils`). Only one file imports `@dshfiles/dshx/client`; `page.tsx`/`entity-row.tsx` etc. are Host-coupled. The `ui/*` primitives (button, card, checkbox, field, badge, alert, progress, radio-group, switch, tooltip, separator, spinner, item, empty) are usable in a standalone SPA.
2. `plugins/@dshfiles/ui-styles/src/theme.generated.css` (304 lines, `--dsw-*` tokens, warm stone + indigo, light/dark) + `src/fonts.css`/`src/fonts` (Geist). Generated from `plugin-ui/src/theme/palette.ts` by `plugin-ui/scripts/emit-theme-css.ts`.
3. `DESIGN.md` §Colors/Typography/Density/Components; `scripts/design-token-check.ts` + `copy-check.ts` (repo ratchets the SPA must pass).
4. `plugin-ui/src/vite.ts` `pluginUiVite()` = tailwind + slim-shiki; the SPA needs only `@tailwindcss/vite`.

## 2. Constraints (from AGENTS.md / docs)

1. Node from **fnm**, `.node-version` = `24.11.1`; Nix `nodejs` breaks dsh at boot (`node-addon-require-builtin unsupported`). Configurator must check `process.execPath` is not under `/nix/store` and the version matches, before anything else.
2. Profiles: `~/.dsh/profiles/<name>/` (or `$DSH_HOME`). Owned bundles only via profile-sync; config in `cordis.patch.yml`, never `cordis.yml`; DSH writes under `package.json.lock` — reuse, never bypass.
3. A **seeded** profile (`web`) is reconciled to its seed on each sync (the `dsh web` supervisor syncs before every start). Pack-composing `web` gets undone. `dshx init` already requires naming `web` explicitly.
4. Secrets never in config/output/seed; refer by env var or `secret:ALIAS`; account files store reference names only (`plugins/@dshfiles/ai-accounts/README.md` ~L282); credentials go to DSH's write-only credential controller (Host).
5. Never restart/stop a running Host; never write a profile a running Host serves (`running-hosts.mjs`; launcher and prepare helper refuse).
6. Experiments in `probe`; validation never against the live web profile or port.
7. `dshx` has no registry presence and must not use `@becomeopc/dshx`.
8. UI: 390 px, 44 px targets, keyboard-only; no modal gates; copy neutral.

## 3. Architecture

### 3.1 Entry points

1. `dshx setup [--home <dir>] [--profile <name>] [--port <n>] [--no-open] [--json]` — new subcommand; `dshx init --ui` is an alias that forwards `--profile/--packs/--home` as SPA defaults. Root script `pnpm setup` = `pnpm install --frozen-lockfile && turbo build --filter=@dshfiles/dshx && node tooling/dshx/packages/dshx/dist/cli/bin.js setup` (needs approval: package.json scripts change).
2. Non-UI parity: every write the UI performs is an `ProfileInit`/`ProfilePlugins` call that `dshx init`/`dshx add` already expose with `--json`, so agents and CI use the CLI and the UI is optional.

### 3.2 Local server

1. `node:http` bound to `127.0.0.1` only, port `--port` or `findFreePort`.
2. Token: `randomBytes(32).toString('base64url')`; printed URL `http://127.0.0.1:<port>/#t=<token>` (fragment: never in logs, Referer or history-server requests). SPA moves it to `sessionStorage` and sends `Authorization: Bearer`. Static assets are public; every `/api/*` requires the token (constant-time compare).
3. Reject requests whose `Host` is not `127.0.0.1:<port>`/`localhost:<port>` (DNS rebinding) and any `Origin` other than self (CSRF); JSON `content-type` only; body limit 64 KB; no CORS.
4. Single writer: one `apply` at a time (mutex); idle shutdown after 30 min without a request; `POST /api/shutdown` and Ctrl-C stop it; process exits after handoff unless `--keep`.
5. Effect-based handlers (`Effect.fn` + spans), decode inputs with Effect Schema (repo default), output envelopes like `CliOutput.emitEnvelope` `{schemaVersion, ok, data|error{code,message,hint}}`.

### 3.3 Endpoints

| Method | Path            | Does                                                                                                                                  | Reads / calls                                                                                                                                                                                             |
| ------ | --------------- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/state`    | env checks, packs, slim catalog, existing profiles + their owned bundles, running Hosts, launcher config presence, suggested projects | §4 checks; `ProfileInit.loadPacks`; `ProfilePlugins.readBundles`; `running-hosts.mjs`; `onboarding` generated catalog projected                                                                           |
| POST   | `/api/plan`     | exact preview for `{profile, packs, extend, project?, settings?}`                                                                     | `ProfileInit.apply({... dryRun: true})` + build plan (stale/unbuilt via `BundleFreshness`) + project/settings diffs                                                                                       |
| POST   | `/api/apply`    | performs the plan; NDJSON stream of steps `{step, status, detail}`                                                                    | re-plan and compare a plan hash sent by the client (refuse if changed); `ProfileInit.apply`; turbo build filtered to composed plugins; `registerScratchWorkspace`-style write; `ProfilePlugins` row merge |
| POST   | `/api/launch`   | start DSH for the profile and return the launch URL                                                                                   | §6                                                                                                                                                                                                        |
| POST   | `/api/shutdown` | stop the server                                                                                                                       | —                                                                                                                                                                                                         |

### 3.4 Writes (and only these)

1. **Profile** — `ProfileInit.apply` (creates profile with DSH's own files + web template bundles, links packs + suppliers via one `profile-sync.ts --bundle` run, `pnpm install`). Never removes; `--extend` semantics surfaced as a checkbox when the profile holds other owned plugins.
2. **Build** — `node scripts/turbo.mjs run build --filter=<composed plugins>...` (dependencies included); only for bundles `BundleFreshness` reports `stale|unbuilt`. Turbo cache makes reruns cheap. This closes the gap `profile-sync` only warns about.
3. **Project** (optional) — register one folder only when `<home>/storages/workspace.json` does not exist (same `wx` semantics as `registerScratchWorkspace`; promote that helper out of `scratch/` rather than copying). If the store exists, do nothing and let the in-app Project step / `workspace-folder-picker` do it (it also offers jj init). Never `jj git init` from the configurator in slice 1.
4. **Key settings** (later phase) — each pack's `keySettings` (`entryId` + `fieldPath`) written as row options through the `dshx add --option` merge code in `add-plugin.ts`; shown in the plan diff.
5. **Launcher config** (later, opt-in) — write `~/.config/dshfiles/launcher.json` (0600) with `sourceRoot`, `dshHome`, `nodeBinary` (fnm path), `coreEntry` (checkout dsh), `profile`; refuse to overwrite an existing file (the launcher fails closed on unknown keys, so emit exactly its schema from `scripts/launcher-config.mjs`).
6. Nothing else: no `accounts.json`, no credentials, no `cordis.yml`, no global installs, no shell profile edits.

### 3.5 SPA package

1. New private workspace package `tooling/dshx/packages/setup-ui` (Vite 8, React 19, `@tailwindcss/vite`). It imports `@dshfiles/plugin-ui/components/ui/*` and `@dshfiles/ui-styles/src/theme.generated.css` + fonts by path.
2. **Cycle hazard**: `plugin-ui → @dshfiles/dshx` (types + one component) and `dshx` would depend on `setup-ui` to embed it. Do not add a package dependency from dshx to setup-ui; instead `setup-ui`'s build writes into `packages/dshx/dist/setup-ui/` (or dshx resolves `DSHFILES_ROOT/tooling/dshx/packages/setup-ui/dist` at run time, like `packs.ts`). Turbo task dependency only, no `package.json` edge; `scripts/workspace-cycles.mjs` and knip must stay green.
3. No data baked in: packs and catalog come from `/api/state`, so the SPA is never stale relative to the checkout (§7).
4. Size target: ≤ 250 KB gz JS+CSS (React 19 ~60 KB gz, radix subset, lucide icons tree-shaken, Tailwind output only for used classes) + Geist woff2 (~2×40 KB). Check with `vite build --report` in CI; no Shiki, no TanStack Table/Charts, no diff viewer.

## 4. Environment checks (`/api/state.checks`)

Each check: `{id, state: ok|warn|fail|unknown, detail, fix}`; `fail` blocks Apply, `warn` does not.

| id                | How                                                                                                                                                                                                                                           | Fix text                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `node-version`    | `process.version === 'v' + .node-version`                                                                                                                                                                                                     | `fnm install && fnm use` (the version is read from `.node-version`)                             |
| `node-origin`     | `process.execPath` not under `/nix/store` and not a Nix profile symlink                                                                                                                                                                       | "dsh needs the official Node build; run inside `nix develop`/direnv or put fnm first"           |
| `fnm`             | `fnm --version` on PATH (warn only)                                                                                                                                                                                                           | link to fnm install                                                                             |
| `pnpm`            | `pnpm --version` ≥ root `packageManager` / corepack                                                                                                                                                                                           | `corepack enable`                                                                               |
| `checkout`        | `DSHFILES_ROOT` has `scripts/profile-sync.ts`, `plugins/@dshfiles/onboarding/src/packs.ts`; `node_modules` present (lockfile hash vs install)                                                                                                 | `pnpm install --frozen-lockfile`                                                                |
| `dshx-built`      | always ok (we are running from dist) — but report dist older than src as warn                                                                                                                                                                 | `turbo build --filter=@dshfiles/dshx`                                                           |
| `dsh`             | `resolveDshExecutable(undefined, env, DSHFILES_ROOT)` → `dsh --version`; compare with the pinned `@deepseek-ai/dsh` in `tooling/dshx/package.json` and with any global `dsh` on PATH (warn on mismatch: a personal launcher may rewrite HOME) | checkout's own dsh is used                                                                      |
| `dsh-home`        | `$DSH_HOME` / `~/.dsh` exists? which profiles, which seeded, which hold owned plugins; refuse a home inside a DSH shell (`DSH_SESSION_ID`/`DSH_SHELL`) whose `DSH_HOME` differs (launcher rule)                                               | pick `--home`                                                                                   |
| `running-host`    | `running-hosts.mjs` for home+profile                                                                                                                                                                                                          | "A DSH already serves this profile; stop it yourself or choose another profile" (never stop it) |
| `port`            | default DSH web port free? (`findFreePort` fallback)                                                                                                                                                                                          | DSH picks one / `--port`                                                                        |
| `browser`         | Playwright chromium only needed for checks, not setup — skip                                                                                                                                                                                  | —                                                                                               |
| `gh`              | `checkGithubAuth` from onboarding (`github-auth.ts`), warn only; drives the GitHub pack prerequisite                                                                                                                                          | `gh auth login`                                                                                 |
| `vcs`             | `jj --version`, `git --version` (warn; Versioning pack prerequisite)                                                                                                                                                                          | install hint                                                                                    |
| `launcher`        | `launcher.json` present/valid via `launcher-config.mjs` (info)                                                                                                                                                                                | —                                                                                               |
| `accounts-detect` | read-only presence: `~/.claude` login, `~/.codex/auth.json`, `*_API_KEY` env **names** only (never values), existing `<home>/plugins/ai-accounts/accounts.json` count                                                                         | "Sign in from AI Accounts after launch"                                                         |

## 5. Screens (progressive, Skip/Back everywhere, 390 px)

1. **Check** — the check list; fails expanded with copyable fix commands; "Re-check" button. Auto-advances when all ok.
2. **Profile** — new name (default `main` when `web` exists and is seeded, else `web`?? see §9 Q1) or an existing non-seeded profile; existing owned set shown with the Extend toggle. Seeded `web` offered only as "Everything (follows the repository)" which runs the seeded `profile-sync` instead of packs.
3. **Packs** — cards from `/api/state.packs` (Core locked on), each with summary, plugin chips, prerequisites coloured from checks (`repository`, `github`), plugin count, and an expandable feature list from the slim catalog (curated only, via `curationOf`).
4. **Project** (optional) — path input + recent candidates (cwd, `~/dev/*` with `.jj`/`.git`, read-only scan bounded); shows jj/git/none; if a workspace store already exists the step says it will be done in DSH.
5. **Accounts** (informational) — detected logins/env names, providers supported; "you'll sign in inside DSH (AI Accounts)"; no input fields.
6. **Review** — the exact `InitProfilePlan`: files (new/edited), plugins (+suppliers), kept, commands, build list, project write, settings rows, restart note. Same diff `dshx init --dry-run` prints.
7. **Apply** — streamed steps (create profile → link → pnpm install → build N plugins → register project → write settings), each with log tail on failure (redacted), Retry; Cancel between steps.
8. **Launch** — "Open DSH" (launch + redirect), or the exact command to run it yourself (`fnm exec --using=… <checkout>/node_modules/.bin/dsh --profile <name> web`, or the launcher), plus "Done".

## 6. Handoff to DSH

1. Re-check `running-host`; if a Host serves this profile, just say so and link nothing (we do not know its token).
2. Spawn `resolveDshExecutable(..., DSHFILES_ROOT)` with `--profile <name> web`, `DSH_HOME` set, detached under its own process group (not the scratch parent-death guard — this Host must outlive the configurator), stdout to `<home>/logs/setup-launch.log` (0600).
3. Wait for `URL_PATTERN` (reuse from `scratch/up.ts`) with a timeout; on exit before URL, surface the boot failure lines (`profile-boot.ts` `failureMarkers`), redacted with `redactUrls`.
4. Return the tokenized URL to the SPA only over the authenticated API; SPA does `location.replace(url)`. Never print it to the terminal log in `--json` mode except in the envelope.
5. Inside DSH the onboarding wizard auto-opens because `account` is not done (`FirstRun.setup`), steering to AI Accounts → Project → First task. Optional later: a `?onboarding=accounts` deep link would need an onboarding change (client reads a query param) — not core.
6. When a launcher config exists, prefer telling the user to run their launcher (it owns supervision/sync-before-start) over spawning a bare Host.

## 7. Staying in sync with the plugin catalog

1. Packs: read live from `onboarding/src/packs.ts` via `ProfileInit.loadPacks` (extend `packSchema` with `prerequisites` and `keySettings`).
2. Features: server projects `FEATURE_CATALOG` (import the generated TS by path, as `loadPacks` does) to `{plugin, description, ui, features: [{id,title,summary,destination,curated}]}` filtered by pack membership — tens of KB, not 991 KB.
3. Staleness is already guarded: onboarding `generate --check`, `features:check`, pack test validating plugin names, `check:pack-docs`. The configurator adds one test: every pack plugin resolves to a local boot bundle (already thrown by `composedBundles`), and the SPA has no checked-in data.
4. P5b (pack membership for all UI plugins) is pending a user decision; until then many seed plugins are in no pack, which is why "Everything (web seed)" must stay an option.

## 8. Testing

1. Server unit (`vitest`, real `node:http`, no mocks): token required, wrong Host/Origin rejected, body limit, one apply at a time, fragment token never logged.
2. Plan/apply integration: temp `DSH_HOME` + real checkout, `ProfileInit.apply` dry-run vs apply equality (plan hash), idempotent second run `upToDate`, refuses seeded `web` without explicit choice, refuses when `running-hosts` reports a Host (fake process not needed: inject the reader).
3. Env checks: table-driven with injected `execPath`/version/PATH (Nix path → fail).
4. SPA: Playwright (repo already has chromium via `setup:browser`) driving `dshx setup --home <tmp> --no-open` end to end through Apply with `--dry-run`, plus one real apply to a scratch home and launch with the checkout dsh (reuse `dshx dev` scratch conventions: `--profile dshx-boot`-style names so `scratch sweep` cleans up). 390×844 pass + keyboard-only pass + screenshot evidence.
5. Repo ratchets: `check:design-tokens`, `check:copy`, oxlint/ast-grep/effect-antislop, knip, `check:cycles`.
6. Never touch the live `~/.dsh` or port in tests.

## 9. Phases (thin first)

| Phase | Scope                                                                                                                                                                                                                                                                 | Acceptance                                                                                                             |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| P0    | Decisions §11                                                                                                                                                                                                                                                         | answered                                                                                                               |
| P1    | `dshx setup` server + SPA: Check → Packs → Review → Apply (profile only, via `ProfileInit`) → "run this command"                                                                                                                                                      | temp-home e2e: dry-run plan equals `dshx init --dry-run --json`; real apply links + installs; idempotent rerun; 390 px |
| P2    | Build step (stale/unbuilt composed bundles), Launch + handoff, running-host guard                                                                                                                                                                                     | scratch home boots, URL reached, onboarding wizard visible; boot failures surfaced                                     |
| P3    | Project step (empty workspace store only), accounts detection, pack `keySettings` via row merge                                                                                                                                                                       | plan shows rows; wizard Project item ticks after launch                                                                |
| P4    | Reconfigure an existing install: extend/disable packs pre-boot (disable = new `ProfilePlugins.removeOwned`, not in init today), launcher.json writer                                                                                                                  | round trip enable → disable leaves profile as before                                                                   |
| P5    | Bootstrap without a checkout: a tiny published package (e.g. `create-dshfiles`) that checks git/jj + fnm, clones into a chosen dir, `fnm install`, `pnpm install`, builds dshx, then execs `dshx setup`. Needs a publish decision (fork currently forbids publishing) | fresh macOS user from zero to DSH Web UI                                                                               |

## 10. Risks

1. **Seeded `web` reverts packs** on next supervisor start (profile-sync seeded mode keeps exactly the seed's `@dshfiles/*`). Mitigation: packs only for non-seeded profiles; `web` = "everything".
2. **Unbuilt bundles**: a fresh clone has no plugin `dist/`; a profile links fine and boots broken. Build step is mandatory; full build of ~110 plugins is slow — filter to composed set + deps.
3. **Workspace cycle** setup-ui ↔ plugin-ui ↔ dshx (§3.5). Keep it a build-output relationship.
4. **Wrong Node**: user runs `dshx setup` under Nix Node; setup succeeds, DSH fails at boot. Check first, spawn DSH with the fnm Node (`fnm exec --using`) explicitly.
5. **Running Host / live profile**: writing under a running Host — guard with `running-hosts` and DSH's `package.json.lock` (already in profile-sync).
6. **Local server exposure**: token + Host/Origin checks + loopback bind; launch URL token returned only over authenticated API.
7. **Workspace store schema drift** (`workspace` unit v2 written directly): only write when absent; prefer deferring to the Host's workspace picker; test against the pinned dsh version.
8. **Catalog size / duplication**: never bundle the 991 KB generated file in the SPA.
9. **Account false promises**: detection of `~/.claude`/`~/.codex` is presence only; AI Accounts makes the real check. Copy must say "found", not "connected".
10. **`npx` expectation**: users will try `npx dshx`. Today it does not exist on npm; anything published under that name must not collide with `@becomeopc/dshx` (forbidden) — check the exact registry before naming (global rule).
11. **Peer deps**: never let setup "fix" missing peers by installing public `@deepseek-ai/*` (older generation) or flipping `autoInstallPeers`.
12. Pack coverage incomplete until P5b (verified in `packs.ts`): `onboarding` is in **no** pack and `ai-accounts` only in Accounts (it may still arrive as a supplier of `onboarding`'s client, unverified). A Core-only profile gets neither, so the handoff wizard and the account sign-in page would be missing. Fix before P2: add both to Core, or have setup always add them.

## 11. Open questions

1. Default profile name for a pack-composed setup (`main`? `web` only for "everything")? And should the launcher's `profile` default follow?
2. Should `onboarding` + `ai-accounts` be forced into every composed profile (handoff depends on them)? Or add them to Core (touches P5b decision)?
3. Is publishing a bootstrapper (P5) acceptable given FORK.md's "nothing here publishes"? Name?
4. `pnpm setup` root script — OK to add (package.json script change needs approval)?
5. Should Launch spawn a bare Host, or require/write the launcher config so supervision + sync-before-start are in place from day one?
