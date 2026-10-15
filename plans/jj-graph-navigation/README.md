# JJ graph navigation

## Objective

Make repository landmarks easy to locate, explain exact revision relationships, and provide reversible graph focus/hide views. Build within the owned Jujutsu plugin, which already owns JJ subprocess reads and graph rendering; no marketplace adoption or core patch needed.

## Progress

| Milestone | Status |
| --- | --- |
| Isolated workspace, architecture inspection, dependency setup | Complete |
| Host landmark and relationship reads with integration tests | Complete (`mnxspszs`) |
| Landmark toolbar and relationship inspector | Complete |
| Connection lens and reversible graph focus/hide | Complete |
| Focused checks and scratch-browser verification | In progress: nine browser journeys passed; final review fixes and responsive assertions awaiting rerun |

Resume here: run final package/static/browser checks, inspect scratch evidence, then retire this plan into the plugin documentation. Parent workspace `jj-graph-navigation`; scratch instance name `jj-graph-navigation` on port 61375. No live profile changes.

## UX invariants

- Locate scrolls without silently resetting filters; excluded targets require explicit reveal.
- Current is selected repository workspace working copy; Default is `default@`, not main.
- Exact selected-only/target-only ancestry counts come from JJ, never a loaded graph page.
- Connection lenses preserve merge ancestry and visibly mark omitted boundaries.
- Hide removes exclusive line ancestry, never shared history needed by retained tips.
- All active filters are visible, removable, and clearable through Show all.
- Temporary views stay local to the selected repository; no JJ mutation.
- Never restart or modify the live DSH profile; verify in scratch runtime.
