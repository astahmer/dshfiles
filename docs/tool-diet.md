# Tool and instruction diet

What every model request in a `web` Session carries before the conversation starts: the tool schemas and the fixed
instruction messages. Measured from the live request, trimmed where it was safe, and the larger levers that remain.

## How to measure

```sh
node scripts/tool-schema-cost.ts ~/.dsh/sessions/<project>/<session-id>/session.v4.jsonl.zstd   # add --json for the full report
```

The script reads the Session's last `request/header` (the exact tool list sent to the provider) and the instruction
messages before it, and prices them with DSH TokenMeter's fixed density: serialized characters / 4. That is the
same estimate the context breakdown shows, not a provider tokenizer. A tool is attributed to the owned plugin whose
source quotes its name; a name quoted by many plugins is a native tool they only mention (`core/native`).

The snapshot in [tool-schemas.json](../tooling/dshx/e2e/fixtures/tool-schemas.json) records the owned Host bundles'
schemas for tests; it is not what a live request carries (no native or MCP tools, no profile composition).

## Baseline, 2026-11-10

One live `web` request (Claude route, 1M context), first request of a root Session in this repository:

| Part                                          | Tokens | Share |
| --------------------------------------------- | -----: | ----: |
| Tool schemas (468 tools, 280,050 bytes)       | 70,013 |  79 % |
| Workspace instructions (both AGENTS.md files) | 12,855 |  15 % |
| Skill catalog                                 |  3,483 |   4 % |
| System prompt (memory start block included)   |  2,097 |   2 % |
| Runtime and time context                      |    265 | < 1 % |
| **Fixed cost per request**                    | 88,713 |       |

Inside the 70k of tool schemas, top-level descriptions are 26.9k (38 %), parameter descriptions 11.2k (16 %) and the
JSON structure (names, types, enums, `oneOf`, `additionalProperties`) the remaining 46 %. Copy trimming alone can
therefore never take off more than about half; the tool count is what scales the cost.

Per owner, largest first (owners under 700 tokens omitted):

| Owner                   | Tools | Tokens |
| ----------------------- | ----: | -----: |
| backlog                 |    49 | 11,320 |
| core/native             |    25 |  5,850 |
| ai-accounts             |    46 |  5,126 |
| multi-host              |    45 |  4,999 |
| thread-sidebar          |    40 |  4,270 |
| traces                  |    17 |  3,769 |
| memory                  |    19 |  2,768 |
| jujutsu                 |    16 |  2,731 |
| jj-integration          |    17 |  2,438 |
| preview                 |    12 |  1,837 |
| workspace-folder-picker |    16 |  1,612 |
| usage                   |     7 |  1,517 |
| agent-questions         |     7 |  1,223 |
| activity-timeline       |    10 |  1,177 |
| project-automations     |     7 |  1,032 |
| project-checks          |     9 |    929 |
| secret-catalog          |     5 |    918 |
| whiteboard              |     6 |    866 |
| html-render             |     3 |    863 |
| agentsview              |     6 |    856 |
| schedule                |     1 |    786 |
| pull-requests           |     7 |    759 |
| agent-communication     |     4 |    716 |
| annotations             |     7 |    702 |

## What was trimmed

Description copy only: no tool was removed, renamed or merged, and every argument, safety rule and opt-in stays.

| Change                                                                                                                                                                      | Tools touched | Tokens saved |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------: | -----------: |
| backlog: shorter item-ref, write-bar and `confirm` sentences; writes that already say "Run only when the user asked" drop the looser note; five long descriptions condensed |            31 |          873 |
| jj-integration: `jj_thread_cleanup` condensed (the longest description sent)                                                                                                |             1 |          109 |
| usage: `usage_activity_report` condensed, keeping the phrases its tests pin                                                                                                 |             1 |           84 |
| preview: shared `pageId` / `sessionId` argument copy                                                                                                                        |            12 |           57 |
| agent-questions: `list_thread_questions` condensed                                                                                                                          |             1 |           67 |

| Measure            |  Before |   After | Change          |
| ------------------ | ------: | ------: | --------------- |
| Tool schema tokens |  70,013 |  68,823 | −1,190 (−1.7 %) |
| Tool schema bytes  | 280,050 | 275,289 | −4,761          |
| backlog            |  11,320 |  10,447 | −873 (−7.7 %)   |

"After" is the same live request with the rebuilt plugins' descriptions substituted, tool by tool, measured with the
same script; the live Host keeps serving the old copy until the user restarts it.

## Next levers, by size

1. **Fewer schemas per request.** [tool-search](../plugins/@dshfiles/tool-search/README.md) hides all but the
   `alwaysVisible` tools behind one `tool_search` tool. On a 603-schema synthetic catalog it cut tool tokens 99 % at
   the cost of one extra request per discovery; the real 335-schema catalog is in its provider benchmark. It is not
   in `web`: adding it changes every agent's first step, rejects calls nested in Code Mode, and needs a restart, so
   it is the user's call. Try it in a `probe` profile with `alwaysVisible` covering the core file and shell tools.
2. **Gate rarely used families behind a setting.** No owned plugin has such a pattern, and dshx's `ApiToolExposure`
   (`tooling/dshx/packages/dshx/src/api/types.ts`) has no condition, so this needs a dshx feature (a settings
   predicate on `tool:`) first. The
   candidates by size: backlog sync (12 tools), multi-host provisioning and remote runtime control (about 20),
   ai-accounts sign-in and connection setup (about 15). The capability stays: the setting only hides the schema.
3. **Workspace instructions.** At 12.9k tokens the two AGENTS.md files cost more than any plugin's tools; they are
   not plugin-owned, so trimming them is a separate editorial pass.
4. **Separate model-facing copy.** `tool.description` already overrides the method description for the agent only,
   so a plugin can keep the full prose in the registry (Agent toolkit page) and send a short form per request.
5. **Merging into action tools** (one tool with a `kind` discriminator) saves names and wrappers but breaks the
   one-method-one-tool binding [agent-tool parity](agent-tool-parity.md) relies on; only worth it once a family is
   measured to be rarely used and gating is unavailable.
