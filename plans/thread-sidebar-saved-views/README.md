# Thread sidebar saved views

| Milestone                                                                 | Status             | Evidence                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inspect current grouping/filter state and migration boundary              | complete           | Existing v1 key stores one group/status/source preference.                                                                                                                                                                           |
| Add validated presets, defaults, operations, and v1 migration             | complete           | `thread-view-preferences.ts` plus focused unit tests.                                                                                                                                                                                |
| Add manager UI, dynamic tabs, and optional quick controls                 | complete           | `thread-view-manager.tsx`, sidebar wiring, English/Chinese labels.                                                                                                                                                                   |
| Add isolated browser journey and feature inventory entries                | complete           | New `thread-view-presets.feature`; E2E passed; inventory reports 83 pre-existing issues only.                                                                                                                                        |
| Run plugin gates and rebuild UI consumers                                 | complete           | Sidebar typecheck/build/import passed; 96 tests and isolated E2E passed. 11 consumers built; 7 existing type/dependency failures remain, and source-only project-folder-picker has no build script (its typecheck and 5 tests pass). |
| Split owned paths into focused JJ change and preserve integration handoff | complete (handoff) | `877d3679` in workspace `thread-view-presets`, based on `15d9f72e`; tree matches validated snapshot. `integration-spine` remains conflicted, so no integration attempted.                                                            |

## Validation notes

- `pnpm --dir plugins/@dshfiles/thread-sidebar typecheck`, `test`, and `build` passed; host `dist/index.js` imported under Node 22.23.3.
- Custom-view browser journey passed twice in disposable DSH profiles. Final run: 1 scenario, 15.3s.
- `features:check` remains red with 83 existing repository issues; new scenario and test references were accepted.
- `oxfmt --check` passed. `oxlint` reported 0 errors and 4 existing warnings in untouched `client.tsx` sections.
- UI-consumer failures match existing dependency/type errors in queue-reorder, model-effort-picker, editor, project-checks, agent-communication, optmem, and ai-accounts.

## Resume here

Integrate revision `877d3679` only after `integration-spine` conflict is resolved. Do not rebase or resolve either conflicted head blindly. Original workspace `thread-view-controls` still contains a duplicate task patch; leave it untouched and coordinate cleanup before any further history surgery.
