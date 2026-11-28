---
name: first-user-qa
description: Run five first-time users through a real scratch DSH browser, rank their screenshot-backed friction, fix it, and replay the same journeys. Use when asked for launch QA or a first-success onboarding audit.
---

# First-user QA

Reusable prompt: “Run `first-user-qa` for <flow>. First success is <observable outcome>.
Use only synthetic data in scratch DSH. Rank the friction, fix what is in scope, then
rerun the same five personas.” Run only on explicit request. Never schedule it or launch agents
while implementing this skill.

## Prepare the journey

1. Load `verify-dsh`. Record the starting screen, one observable first-success condition,
   allowed bundles, synthetic fixture and reset steps, and browser settings. If no journey
   is supplied, use `--plugin @dshfiles/tool-search` (a Host-only bundle). Start at the stock
   scratch app root and try to open the new-session composer for `sample` without sending a
   message. Give personas the goal, not the steps to reach it.
2. Create a fresh private temp state root (`mktemp -d`; export it as `DSHX_DEV_STATE_ROOT`
   for every `dshx dev` call) and a separate private report directory. The root scopes
   named-state cleanup, not the launcher's global orphan and legacy-process sweep. Start
   instances serially with `dshx dev up --name before-<persona> --fake-secret-cli --json`
   and the same required `--plugin` flags. Immediately record each successful launch's name
   and state directory in the report directory **before** running `doctor`. On error, stop
   every recorded instance with `dshx dev down --name <name> --state-dir <state-dir>`, even
   if a later launch or `doctor` failed.

   Use only the scratch `sample` project, not `--project`, a live Host, private sessions, a
   real vault, accounts or real model calls. A journey that needs a model must use a loopback
   fake provider. Record setup separately from user actions. If the bundle mix is unproven,
   use a separately recorded throwaway instance to check that the client reaches the first
   screen. A green `doctor` does not prove that the client rendered.

3. Give each subagent its persona, common goal, scratch **public origin** and **state directory**
   from `up --json`, and a private absolute evidence directory outside the checkout. In every
   brief explicitly forbid any native picker (including **Open folder** and **Choose file**)
   and any real folder. Use `sample` only. Never send the launch URL, token or cookies. Do not
   use `dshx dev open` to start the journey: it dismisses first-run dialogs. Use the browser
   instructions in [BROWSER.md](BROWSER.md).

## Baseline and evidence

Start exactly one subagent per persona. They drive a real browser, do not read the app's
implementation or a walkthrough, do not share findings mid-pass, and do not edit product code.
Each stops at the first verified success or when it cannot continue safely. Use the same five
roles for the retest:

- `impatient`: Skim, click the first plausible action, and quit at the first error.
- `careful`: Read terms, privacy and settings before committing. Note missing information,
  and do not follow external links.
- `mobile`: Use an emulated 375 × 844 px touch phone (mobile layout, touch input) on emulated slow 3G for the whole journey.
- `literal`: As a non-native English reader, follow only the literal UI copy. Do not infer
  from product knowledge.
- `breaker`: Paste harmless malformed fixture text, go back mid-flow, and double-click
  scratch-only actions.

Capture a screenshot at **each** point of confusion, blockage or annoyance before moving on.
Use a different filename each time (e.g. `03-unclear-button.png`). Record the step, actual
visible behavior, expected behavior or unanswered question, and screenshot path. Return the
sequence of actions, browser settings, end state (`success`, `blocked`, or `not-run`) and a
success screenshot if reached. Report capture and setup failures separately; do not substitute
an inferred result or count an infrastructure failure as product friction. Never include launch
credentials, raw URL queries or unrelated data in output or screenshots.

## Rank, fix, replay

1. Group observations of the same user-visible problem into one finding with a stable slug `id`,
   title, and all observations (`persona`, `step`, `note`, `screenshot`). Don't group unrelated
   problems just because they share a screen. Write the array to `baseline.json` in the private
   report directory, then run from the repository root:

   ```sh
   node .agents/skills/first-user-qa/rank.mjs < "$REPORT_DIR/baseline.json" > "$REPORT_DIR/ranked.json"
   ```

   This sorts by distinct personas, breaks ties by ID, and keeps every observation. Report a
   single ranked list with affected personas, reproduction steps and screenshot links. Report
   incomplete personas separately; a persona blocked early has not tested later steps.

2. Stop the baseline instances with their recorded `dshx dev down` commands. Fix the causes of
   ranked findings in one pass within the authorized scope. Leave out-of-scope or core findings
   open with evidence. Never patch core or restart live DSH. Keep baseline evidence.
3. Rebuild and start fresh `after-<persona>` instances with the same bundle flags, fixture,
   first screen, goal and browser settings. Record these launches for cleanup too. Dispatch the
   same five roles without hints about what changed. After each blind pass, restore the starting
   fixture if it changed, then have the persona replay its baseline friction steps where applicable
   and capture the same screens under new paths. Run the ranker on `retest.json`, including new
   findings. For each baseline item report `fixed` only with comparable replay evidence; otherwise
   report `still present` or `not verified`. Link before and after screenshots, report success
   counts and any new findings, and stop every remaining instance even on failure. Keep evidence
   outside the scratch home and never commit it.
