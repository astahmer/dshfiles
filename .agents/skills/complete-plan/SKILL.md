---
name: complete-plan
description: Turn a finished plan in plans/ into documentation and delete it. Use when a plan's last task is done and verified, when a plan's remaining items have all shipped, or when asked to close, retire, land or convert a plan into docs.
---

# Complete a plan

A plan lives in `plans/` only while work remains. When it is done, its durable
content moves to the docs that own the behavior and the plan is deleted.

## 1. Confirm it is done

Check the code and tests, not the plan's own checkboxes: each claimed item has
source, a test or a receipt on `main`. Items still open mean the plan is only
partly done: keep it, trimmed to what is left (step 4).

## 2. Pick the destination

- One plugin: its `README.md`, or `plugins/@dshfiles/<x>/docs/<topic>.md` for
  design, research or evidence too long for the README.
- dshx: `tooling/dshx/docs/`.
- The desktop app: `apps/desktop/README.md`.
- Cross-cutting (testing, profiles, repository workflow): `docs/`, and add the
  file to the table in `docs/README.md`.

Read the destination first and write in its voice: plain sentences, present
tense, the behavior as it is now.

## 3. Move what lasts, drop the rest

Keep:

- the decisions and why they were made, including options rejected for a
  reason that still holds;
- constraints and limits, and what is deliberately not done;
- the final behavior, how to use it, how to verify it (exact commands);
- benchmark conclusions and measured numbers that justify a default.

Drop: task checklists, progress tables, "Resume here" notes, session or
workspace ids, revision hashes of work in progress, dated status lines, and
alternatives that no longer matter.

Evidence files the docs link to (benchmark results, source snapshots,
receipts) stay or move next to the doc; never leave a doc pointing into
`plans/`.

## 4. Delete or trim the plan

- Done: delete the plan file or folder.
- Partly done: rewrite it to the open items only, with a one-paragraph header
  linking to where the finished part is documented.
- Update `plans/README.md` and fix every link to the plan
  (`grep -rn "plans/<name>" --include='*.md' .`).

## 5. Land it

One jj revision per plan (or per topic when plans overlap), e.g.
`docs(<scope>): fold the <plan> plan into <destination>`, with a body saying
what moved and what was dropped. Run `pnpm run fmt:check` and `pnpm run lint`.
