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

[tool-search](../plugins/@dshfiles/tool-search/README.md) restricts each agent to its `alwaysVisible` tools plus one
`tool_search` tool; a search adds its top `maxResults` (5) BM25 matches to that agent's allow list for the rest of the
Session. Measured in a scratch DSH (`dshx dev up --name toolsearch`, isolated home and port) with every owned bundle
`profiles/web` depends on, once without and once with `--plugin @dshfiles/tool-search`, driven by the loopback fake
provider (`[[call TOOL {json}]]` directives) and read with `node scripts/tool-schema-cost.ts` on the scratch Session
logs. The baseline request carries the same 468 tools as the live `web` request above.

| Configuration (same 97 owned bundles)                                      | Tools in first request | Tool chars | Tool tokens |
| -------------------------------------------------------------------------- | ---------------------: | ---------: | ----------: |
| Without tool-search                                                        |                    468 |    274,965 |      68,742 |
| tool-search, defaults (`alwaysVisible: []`)                                |                      4 |      3,085 |         772 |
| tool-search, `alwaysVisible` = the 31 native core tools                    |                     12 |      8,650 |       2,163 |
| Projected: the 31 native core tools + `tool_search`, once the bug is fixed |                     32 |     26,930 |       6,733 |

The projection sums the baseline schemas of `read`, `write`, `edit`, `apply_patch`, `bash`, `glob`, `grep`,
`todo_write`, `skill`, `ask_user_question`, `job_*`, `subagent*`, `send_message`, `list_agents`, `interrupt_agent`,
`web_search`, `web_fetch`, `present`, `read_image`, the goal tools, `exit_plan_mode`, `workflow`, `working_directory`
and `compaction_threshold`, plus the 519-char `tool_search` schema.

### Round trips

Three scripted tasks in one thread, each one discovery then one call (`tool_search "list backlog items"` →
`backlog_list`, `"jj thread workspace status"` → `jj_thread_status`, `"open a page in the preview browser"` →
`preview_open`):

| Task               | Requests without | Requests with | Loaded by the search                                                           | Tool tokens after |
| ------------------ | ---------------: | ------------: | ------------------------------------------------------------------------------ | ----------------: |
| `backlog_list`     |                2 |             3 | `backlog_list`, `_projects`, `_get`, `_sync_binding_remove`, `_referencing`    |             1,847 |
| `jj_thread_status` |                2 |             3 | `jj_thread_status`, `_workspace_sync`, `_discard`, `_destination`, `_refresh…` |             2,327 |
| `preview_open`     |                2 |             3 | `preview_open`, `_reveal`, `_screenshot`, `_close`, `_navigate`                |             3,042 |

Each discovery costs one extra model request and grows the tool list by 5 schemas (about 500 to 1,200 tokens) for the
rest of the Session; nothing is ever unloaded. Ten searches in one thread reached 43 tools and 8,932 tokens. Every
target ranked first and was then called successfully; calling a deferred tool before searching fails with
`ToolNotFoundError` (`unknown tool "backlog_list"`), which the model must recover from with another request.

Retrieval on the real catalog: the plugin's own ranker (`ToolSearchModel.rank`) over the 468 live schemas puts the
target in the top 5 for 14 of 20 natural-language queries. It misses paraphrases that share no words with the
description: "show my open tasks" (`backlog_list`, rank 11), "create a new todo item in the task tracker"
(`backlog_capture`, 117), "what revisions does this thread have that are not on main" (`jj_thread_status`, 42), "land
this thread onto main" (`jj_thread_rebase`, 43), "which secrets are configured" (`secret_list`, 19), "remind me in an
hour" (`schedule_create`, 116). The earlier Codex benchmark in the plugin README saw the same pattern with a real
model: 9/12 tasks against 12/12 direct.

### Failure modes

1. **The core tools disappear and cannot be found.** With either configuration the agent loses `bash`, `read`,
   `write`, `edit`, `todo_write`, `skill`, `ask_user_question`, `job_*`, `send_message`, `subagent_fork`,
   `list_agents`, `interrupt_agent`, `web_search`, `web_fetch`, `present`, `read_image`, `exit_plan_mode` and
   `workflow`: they are agent-scoped registrations, absent from the global catalog `tool_search` ranks
   (`tool_search "bash"` returns `thread_dev_servers`, `"read"` returns `backlog_read_file`…), and the plugin's
   `tools.restrict({ allow })` list is built from global names only, so `alwaysVisible` cannot admit them either. The
   seeded `bash` call failed with `unknown tool "bash"` in every tool-search run. Only `glob`, `grep` and `subagent`
   survived. Fixing this means building the allow list from `ctx.tools.schemas(agent)` names that are not global, in
   `refreshRestriction` (`plugins/@dshfiles/tool-search/src/host.ts`).
2. **Prompt-cache churn.** The tool list changes after every search, so the cached prefix the provider keeps for an
   unchanged header is lost each time; the Codex benchmark recorded almost no cached input in progressive mode
   against 72 % cached direct.
3. **Paraphrase misses**, above: BM25 over names and descriptions only.
4. **Code Mode** calls nested through `run_code` are rejected by design.

### Recommendation

Do not adopt in `web` yet. The default configuration removes the file and shell tools outright, so an agent cannot
work. After the allow-list fix, adopt only with an always-visible core set: the projected 6.7k tokens per request is
about a tenth of today's 68.7k, at one extra request per tool family a task needs and a cache miss after each
discovery. Before switching, re-run this measurement with a real model on long multi-turn Sessions, where the direct
mode's cached schema prefix amortizes best.

## Next levers, by size

1. **Fewer schemas per request.** tool-search, measured above: about 90 % fewer tool tokens with a core set, but it
   currently hides the agent-scoped core tools and needs that fix first. Not in `web`: adding it changes every
   agent's first step and needs a restart, so it is the user's call.
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
