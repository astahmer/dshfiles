---
name: maintain-verify-dsh
description: Keep verify-dsh, `dshx dev` and the catalog `reach` steps in sync with DSH after a change that affects how a scratch DSH is launched, seeded, driven or verified. Use as the last step of a change to tooling/dshx/e2e/support, tooling/dshx/packages/dshx/src/scratch or src/cli/scratch.ts, the dshx.features.json schema, profile seeding (boot-profile, scratch-profile, profiles/web), or a feature's UI path; or when `dshx dev open` failed.
---

# Maintain verify-dsh

The DSH instance of `maintain-verification-skill`. Event-driven: run it scoped
to what the change touched. `dshx` is defined in `verify-dsh`.

## Trigger check

Run it when the change touched any of:

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
   dshx dev down && pgrep -fl 'dshx-boot-profile|browser-host.js' || echo clean
   ```
   A `reach` not walked green in this session stays unverified; say so.
5. **Triage each failure** (look at the failure screenshot and `shot` summary):
   - **Doc drift** (a name or step changed, the feature works by hand): fix
     `reach` or the skill.
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
