# Phase 5 part B evidence: one mention registry, Context facet, one Jev key

Scratch DSH (`dshx dev up --skip-build`, owned bundles from the `ade-5b` workspace, stock core 0.2.1-rc.2), WebKit
driver from [`baseline/capture/phone.mjs`](../../baseline/capture/phone.mjs): desktop 1440×900 and iPhone 390×844.
No provider is configured; the fake Command Code route answers, so user messages and their references render.

| Shot | What it shows |
| --- | --- |
| [agent-preview-desktop](agent-preview-desktop.png), [agent-preview-phone](agent-preview-phone.png) | A written `@{dsh}` mention opens the agent card inside input-trigger's one shared reference card (`[data-dshfiles-entity-preview="agent"]`); it fits the phone width |
| [backlog-preview-desktop](backlog-preview-desktop.png) | The sent `b:1` chip opens the backlog card in the same overlay (missing-item state: the scratch has no item 1) |
| [at-menu-desktop](at-menu-desktop.png), [at-skill-scope-desktop](at-skill-scope-desktop.png) | `@` still lists Skills, then Threads & files with the scope hint; `@skill:` narrows to skills: the groups now register through the entity registry, order unchanged (each source keeps its own `order`) |
| [context-desktop](context-desktop.png), [context-phone](context-phone.png) | Thread panel **Context** tab: AGENTS.md (from DSH's own instruction loader), agent, memory start block, skills, MCP servers, references, each with ≈ tokens; no horizontal overflow at 390 px |
| [jev-settings-desktop](jev-settings-desktop.png), [jev-settings-phone](jev-settings-phone.png) | Settings › Tools & MCP › Jev leads with the one **Key**; Backlog and Memory keep only their switches |
| [backlog-jev-link-desktop](backlog-jev-link-desktop.png), [backlog-jev-link-opens-key-desktop](backlog-jev-link-opens-key-desktop.png) | Backlog's Jev section links to the shared key instead of its own field; the link opens Settings on it |

Seen, not fixed here:

- On the phone, a Settings row with a text input squeezes its label to one word per line (`jev-settings-phone`). The
  row layout is settings-shell's shared form, so this is a Phase 6 phone item, not specific to the Jev key.
- The `tool-call-thread` seed fails with the known core tool-scheduler error (`reading 'prepare'`), so catalog reaches
  that depend on it were driven by plain user messages instead.
