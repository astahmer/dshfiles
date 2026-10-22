---
name: maintain-verify-dsh
description: Keep verify-dsh, `dshx dev` and the catalog `reach` steps in sync with DSH after a change that affects how a scratch DSH is launched, seeded, driven or verified. Use as the last step of a change to tooling/dshx/e2e/support, tooling/dshx/packages/dshx/src/scratch or src/cli/scratch.ts, the dshx.features.json schema, profile seeding (boot-profile, scratch-profile, profiles/web), or a feature's UI path; or when `dshx dev open` failed.
---

# Maintain verify-dsh

The DSH instance of `verification-skill` (maintain mode). Event-driven: run it scoped
to what the change touched. `dshx` is defined in `verify-dsh`.

## Trigger check

Run it when the change touched any of:

- `tooling/dshx/scripts/{browser-tasks,run-e2e,boot-check-web}.mjs` or `scripts/check-browser.mjs`;
- `tooling/dshx/e2e/support/*` or `packages/dshx/src/project/{boot-profile,scratch-profile,local-bundles,startup-dialogs,owned-process}.ts`;
- `packages/dshx/src/scratch/*` or `src/cli/scratch.ts` (`dshx dev`);
- `packages/dshx/src/project/features.ts` (catalog schema, `reach` grammar);
- `profiles/web`, `scripts/profile-*`, or anything `up` copies;
- a plugin's UI path: a renamed button, label or dialog, a moved slot, a new
  user-facing feature in a `dshx.features.json`.

If none applies, stop: **Clean**.

## Process

1. **Hygiene.**
   `fnm exec --using=22.23.3 pnpm --dir tooling/dshx run features:check` — every
   catalog parses, `reach` steps match the grammar and end with `expect`. List
   the affected features: changed catalogs, plus features whose plugin source
   changed (`jj diff --name-only`). A new user-facing feature gets `reach` when
   one short path from the app root reaches it.
2. **Source wave (read-only).** For each affected feature, read the component
   that renders it (`grep -rn "aria-label\|t('" plugins/@dshfiles/<p>/src`) and
   its locale strings: roles, accessible names, the dialog it opens, what makes
   it render (a selected project, a recent thread, a jj repo). Note every
   mismatch with `reach`, `verify-dsh` or `dshx dev --help`.
3. **Reconcile.** Fix `reach` to the code (the code owns names and paths); fix
   `verify-dsh` text and `dshx dev` help/behavior (the skill owns how to drive).
   Keep the skill thin: new gotchas get one line.
4. **Live pass (required).**
   ```sh
   dshx dev up --plugin <each affected plugin> --json
   dshx dev doctor
   dshx dev open <plugin>/<feature>      # each affected feature
   dshx dev shot --label <feature> --json
   dshx dev down && pgrep -fl 'dshx-boot-profile|browser-host.js|scratch/watchdog.js' || echo clean
   ```
   `up` runs `down` on other agents' stale instances under the state root. A
   spec or live pass that exercises the lease, warning grace, watchdog or sweep
   sets `DSHX_DEV_STATE_ROOT` to its own temp dir (`dev-scratch.spec.ts` does),
   so it can never stop an instance in `$TMPDIR/dshx-dev`. A startup warning is
   the two-phase stop, not drift: `doctor` reports the answered warning, and
   `dshx dev keep --forever` pins an instance a long pass must keep.
   A `reach` not walked green in this session stays unverified; say so.
   Then `pnpm check:e2e <plugin>` for each touched plugin: its journeys must be
   green before landing (`pnpm check` runs only the `@smoke` subset). A shared
   step (`steps.ts`, a boot or navigation helper) can break plugins it does not
   name: also run `pnpm check:e2e:smoke`. A new or retagged feature file, or a
   step moved between step files, needs
   `node tooling/dshx/scripts/browser-tasks.mjs --write` (`dshx check` fails
   on drift).
5. **Triage each failure** (look at the failure screenshot, `shot` summary or
   the journey's `test-results/*/error-context.md`):
   - **Doc drift** (a name or step changed, the feature works by hand): fix
     `reach`, the journey's step file, or the skill.
   - **Harness gap** (`dshx dev` cannot seed, wait for or capture something):
     fix `dshx dev`, add a spec in `packages/dshx/tests/dev-scratch.spec.ts`.
   - **Product regression** (the feature is broken for a user): do not edit
     product code or weaken `reach` to pass; report it with the evidence paths.
   - **Environment** (load, port, missing Chromium, pnpm store): retry once,
     then report.

## Outcome

End with exactly one:

- **Clean:** nothing drifted; live pass green.
- **Changed:** what was fixed, as one described jj revision, plus the green
  live pass (commands and evidence paths).
- **Blocked:** what failed, evidence paths, and whether it is a product
  regression or an environment problem.
