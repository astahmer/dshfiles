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

## tool-search in a scratch profile, 2026-11-10

[tool-search](../plugins/@dshfiles/tool-search/README.md) defers each agent's global tools behind one `tool_search`
tool; a search adds its top `maxResults` (5) BM25 matches for the rest of the Session. The tools an agent gets from its
own or its agent preset's scope (`bash`, `read`, `write`, `schedule_*`, …) are not global and stay visible, and
`alwaysVisible` defaults to the native core globals (`apply_patch`, `glob`, `grep`, `subagent*`, the goal tools,
`working_directory`, `compaction_threshold`, …). Measured in a scratch DSH (`dshx dev up --name toolsearch2`, isolated
home and port) with every owned bundle `profiles/web` depends on, once without and once with
`--plugin @dshfiles/tool-search`, driven by the loopback fake provider (`[[call TOOL {json}]]` directives) and read
with `node scripts/tool-schema-cost.ts` on the scratch Session logs.

| Configuration (same 98 owned bundles)                                    | Tools in first request | Tool chars | Tool tokens |
| ------------------------------------------------------------------------ | ---------------------: | ---------: | ----------: |
| Without tool-search                                                      |                    469 |    275,609 |      68,902 |
| tool-search before the fix, `alwaysVisible: []` (core tools lost)        |                      4 |      3,085 |         772 |
| tool-search before the fix, `alwaysVisible` = 31 core names (core lost)  |                     12 |      8,650 |       2,163 |
| tool-search, defaults (agent-plane tools + core globals + `tool_search`) |                     36 |     32,912 |       8,228 |

The 36 tools are `bash`, `read`, `write`, `edit`, `todo_write`, `skill`, `ask_user_question`, `job_*`, `send_message`,
`subagent*`, `list_agents`, `interrupt_agent`, `web_search`, `web_fetch`, `present`, `read_image`, `exit_plan_mode`,
`workflow` and `schedule_*` from the agent plane, the core globals above, and `tool_search`. The two "before the fix"
rows are from the first scratch run, when the plugin's allow list hid every agent-plane tool.

### Round trips

One thread: the `tool-call-thread` seed's opening `bash` call, then three tasks of one discovery and one call each
(`tool_search "list backlog items"` → `backlog_list`, `"jj thread workspace status"` → `jj_thread_status`,
`"open a page in the preview browser"` → `preview_open`), then `read` and a second `bash`:

| Task               | Requests without | Requests with | Loaded by the search                                                           | Tool tokens after |
| ------------------ | ---------------: | ------------: | ------------------------------------------------------------------------------ | ----------------: |
| opening `bash`     |                2 |             2 | (agent-plane, always visible)                                                  |             8,228 |
| `backlog_list`     |                2 |             3 | `backlog_list`, `_projects`, `_get`, `_sync_binding_remove`, `_referencing`    |             9,304 |
| `jj_thread_status` |                2 |             3 | `jj_thread_status`, `_workspace_sync`, `_discard`, `_destination`, `_refresh…` |             9,784 |
| `preview_open`     |                2 |             3 | `preview_open`, `_reveal`, `_screenshot`, `_close`, `_navigate`                |            10,499 |
| `read`, `bash`     |                4 |             4 | —                                                                              |            10,499 |

All 9 calls succeeded with tool-search, both `bash` calls included. The whole thread sent 18 requests carrying
174,529 tool tokens in total; without tool-search the 12 requests that skip the three searches carried 826,824
(−79 %). Each discovery costs one extra model request and grows the tool list by 5 schemas (about 500 to 1,100
tokens) for the rest of the Session; nothing is ever unloaded. Every target ranked first; calling a deferred tool
before searching fails with `ToolNotFoundError` (`unknown tool "backlog_list"`), which the model must recover from with
another request.

### Real model

The plugin's opt-in Codex benchmark (`src/provider-benchmark.test.ts`, `codex-alex2`, `gpt-6-luna`, high effort,
existing ai-accounts login, request budget 15) on the `real-335` catalog, tasks phrased by intent:

| Task                | Direct: success, requests | Progressive: success, requests | Progressive searches |
| ------------------- | ------------------------: | -----------------------------: | -------------------: |
| `running-jobs`      |                      ✓, 2 |                           ✓, 3 |                    1 |
| `capture-bug`       |                      ✓, 2 |                           ✓, 5 |                    3 |
| `subscription-left` |                      ✓, 2 |               (budget reached) |                    — |

3/3 direct, 2/2 progressive. Direct sent 62.4k estimated tool tokens per request, but the provider served the
second request's 40.2k prompt tokens from cache; progressive sent 476 to 3,061 per request and nothing was cached. The
catalog has no agent-plane tools, so this measures discovery, not the fix. A failed paraphrase (`capture-bug` needed
three queries) costs a request each.

Retrieval on the real catalog: the plugin's own ranker (`ToolSearchModel.rank`) over the 468 live schemas puts the
target in the top 5 for 14 of 20 natural-language queries. It misses paraphrases that share no words with the
description: "show my open tasks" (`backlog_list`, rank 11), "create a new todo item in the task tracker"
(`backlog_capture`, 117), "what revisions does this thread have that are not on main" (`jj_thread_status`, 42), "land
this thread onto main" (`jj_thread_rebase`, 43), "which secrets are configured" (`secret_list`, 19), "remind me in an
hour" (`schedule_create`, 116). The earlier Codex benchmark in the plugin README saw the same pattern with a real
model: 9/12 tasks against 12/12 direct.

### Failure modes

1. **Fixed: the core tools disappeared.** Agent presets mount `bash`, `read`, `write` and the other agent-plane tools
   in a parent scope of each agent, and `tools.restrict()` filters everything an agent inherits, so the plugin's
   `allow` list of global names hid them (`unknown tool "bash"`). The plugin now denies only the deferred global
   names; `agent-loop.integration.test.ts` runs a preset-scoped `bash` through the real tool registry.
2. **Prompt-cache churn.** The tool list changes after every search, so the cached prefix the provider keeps for an
   unchanged header is lost each time; the Codex benchmark recorded almost no cached input in progressive mode
   against 72 % cached direct.
3. **Paraphrase misses**, above: BM25 over names and descriptions only.
4. **Code Mode** calls nested through `run_code` are rejected by design.

### Recommendation

Usable now; adopting it in `web` is a restart and the user's call. With the defaults an agent keeps every core tool
and starts at 8.2k tool tokens instead of 68.9k (−88 %), at one extra request per tool family a task needs and a
prompt-cache miss after each discovery. Try it in `web` as a reversible trial (remove the row to undo) rather than a
default: the cache churn and paraphrase misses only show their real cost on long multi-turn Sessions with the Claude
route, which neither run above covers.

## Next levers, by size

1. **Fewer schemas per request.** tool-search, measured above: 88 % fewer tool tokens on the first request with the
   default core set. Not in `web`: adding it changes every agent's first step and needs a restart, so it is the
   user's call.
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
