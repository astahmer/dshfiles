# Phase 0 baseline: the 8 journeys today

Captured 2026-11-04 from a scratch DSH (stock core 0.2.1-rc.2, every owned bundle under `plugins/@dshfiles`, 79
bundles) built from `jj:main` at `c0f9904e`. Nothing here comes from the live instance or private data. Later phases
compare their screenshots with these.

- **Desktop:** 1440×900, WebKit, light (`*-desktop.png`). Three key screens also in dark (`*-desktop-dark.png`).
- **Phone:** 390×844, WebKit as iPhone (`isMobile`, touch, iOS Chrome user agent, 2× rendered then scaled to 75 %)
  (`*-phone.png`). iPhone Chrome uses WebKit, so this is the engine that matters.
- 41 images, quantised to 128-colour PNG (≈2.2 MB). `03-question-attempt-desktop.png` is the one Chromium capture
  (from `dshx dev open`, see journey 3).

## Images

| # | Journey | Desktop | Phone | What it shows |
| --- | --- | --- | --- | --- |
| 1 | Start a thread | [01-start-thread-desktop](<01-start-thread-desktop.png>), [dark](<01-start-thread-desktop-dark.png>) | [01-start-thread-phone](<01-start-thread-phone.png>) | New-thread hero: headline, run chips (Local · project · branch · ☐ workspace · mode), Changes strip, composer, Resume links |
| 1b | Pick a project | [01b-project-picker-desktop](<01b-project-picker-desktop.png>) | [01b-project-picker-phone](<01b-project-picker-phone.png>) | Project picker overlay (No folder + sample with absolute path) |
| 2 | Thread list | [02-thread-list-desktop](<02-thread-list-desktop.png>) | [02-thread-list-phone](<02-thread-list-phone.png>) | Sidebar **All threads** view (Group: Status; Pinned / Active). Phone: sidebar expanded with **Expand sidebar** |
| 2b | Several in parallel | [02b-thread-board-desktop](<02b-thread-board-desktop.png>) | [02b-thread-board-phone](<02b-thread-board-phone.png>) | **Thread Sidebar: Board** page (Pinned / Active / Parked / Inactive columns) |
| 3 | Answer a question | [03-question-attempt-desktop](<03-question-attempt-desktop.png>) | [03-question-attempt-phone](<03-question-attempt-phone.png>) | The thread where a fake-provider turn called `ask_user_question`; **no question card appeared** (see below) |
| 4a | Review: Changes | [04a-changes-desktop](<04a-changes-desktop.png>), [dark](<04a-changes-desktop-dark.png>) | [04a-changes-phone](<04a-changes-phone.png>) | Workspace thread with a failed turn, the in-transcript "Integrate into main" card and the expanded "Changes since branching from main" strip |
| 4b | Land: Thread integration | [04b-thread-integration-desktop](<04b-thread-integration-desktop.png>) | [04b-thread-integration-phone](<04b-thread-integration-phone.png>) | **JJ Integration: Thread integration** page with one ready workspace |
| 4c | Land: Jujutsu | [04c-jujutsu-graph-desktop](<04c-jujutsu-graph-desktop.png>) | [04c-jujutsu-graph-phone](<04c-jujutsu-graph-phone.png>) | **Jujutsu: Revision graph** for `sample` with three thread workspaces |
| 4d | Review: pulls.review | [04d-pulls-review-desktop](<04d-pulls-review-desktop.png>) | [04d-pulls-review-phone](<04d-pulls-review-phone.png>) | **pulls.review: Reviews** page |
| 5a | What needs me: Activity | [05a-activity-desktop](<05a-activity-desktop.png>) | [05a-activity-phone](<05a-activity-phone.png>) | **Activity Timeline** feed with "1 attention" |
| 5b | What's running: Jobs | [05b-jobs-desktop](<05b-jobs-desktop.png>) | [05b-jobs-phone](<05b-jobs-phone.png>) | **Background Jobs** board (empty) |
| 5c | What needs me: Backlog inbox | [05c-backlog-inbox-desktop](<05c-backlog-inbox-desktop.png>) | [05c-backlog-inbox-phone](<05c-backlog-inbox-phone.png>) | **Backlog › Inbox** ("Nothing needs you") |
| 6 | Find a past thread | [06-palette-threads-desktop](<06-palette-threads-desktop.png>) | [06-palette-threads-phone](<06-palette-threads-phone.png>) | Command palette › **Threads** tab searching "thread" |
| 7a | Configure: AI account | [07a-ai-accounts-desktop](<07a-ai-accounts-desktop.png>) | [07a-ai-accounts-phone](<07a-ai-accounts-phone.png>) | **AI Accounts** page with the fake Command Code account |
| 7b | Configure: MCP | [07b-mcp-servers-desktop](<07b-mcp-servers-desktop.png>) | [07b-mcp-servers-phone](<07b-mcp-servers-phone.png>) | **MCP Servers** page (add form, empty list) |
| 7c | Configure: secret | [07c-secret-catalog-desktop](<07c-secret-catalog-desktop.png>) | [07c-secret-catalog-phone](<07c-secret-catalog-phone.png>) | **Secret Catalog** with one synthetic alias (`GITHUB_TOKEN` from the fake secret CLI) |
| 7d | Configure: Settings | [07d-settings-desktop](<07d-settings-desktop.png>) | [07d-settings-phone](<07d-settings-phone.png>) | **Settings** (Account menu › Settings), General section |
| 8a | Cost/usage: Usage | [08a-usage-desktop](<08a-usage-desktop.png>), [dark](<08a-usage-desktop-dark.png>) | [08a-usage-phone](<08a-usage-phone.png>) | **Usage: Analytics** request log |
| 8b | Cost/usage: AI Accounts | [08b-ai-accounts-usage-desktop](<08b-ai-accounts-usage-desktop.png>) | [08b-ai-accounts-usage-phone](<08b-ai-accounts-usage-phone.png>) | **AI Accounts: Usage history** (quota) |

The sidebar quota card ("CC1 10% ↻ 2d 23h"), the composer footer meter and the conversation **Requests** tab — the other
journey-8 surfaces — are visible in most desktop shots.

## Observed defects

Severity is a judgement for the redesign, not a bug triage. "Both" means desktop and phone.

### Shell and navigation (all journeys)

1. **Duplicate chrome in the left column.** Three Dockview panels stack in the sidebar, each with its own tab strip
   (`×  Thread Sidebar: Na…  +  ⌄1  ⋯  ×`), and both titles are truncated ("Thread Sidebar: Na", "Thread Sidebar: Th").
   Desktop, every shot.
2. **The icon rail is a horizontally scrolled strip**, so the visible icons change from page to page and the first
   icon is often cut in half (compare 04b, 05a and 05c desktop). Icons have no labels.
3. **Centre tab strip fills with duplicates**: several "New thread" tabs and identical "Fake thread title" tabs;
   page tabs are italic previews with plugin-prefixed names ("AI Accounts: Usage history", "Settings Shell: Settings").
4. **Phone keeps the desktop shell.** A 56 px icon rail takes 14 % of a 390 px screen; the tab strip shows two
   truncated tabs plus "⌄3"; there is no bottom navigation.
5. **The thread list is not reachable on phone** without **Expand sidebar**, and expanding it squeezes the stage to
   ~190 px: the error text wraps one letter per line and "New thread" overlaps "Search threads"
   ([02-thread-list-phone](<02-thread-list-phone.png>)). The palette button is also hidden on phone; only the rail's
   search icon opens it.
6. **No document-level horizontal overflow** was measured on any screen (scrollWidth = clientWidth at 390 and 1440).
   The overflow is inside containers instead: composer chip row ("wor[kspace]" cut), Activity filter chips ("Attent",
   "Ret" cut), Jobs header ("Refresl"), Usage table (columns cut, scrolls inside the card), board horizontal scrollbar.

### Journey 1 — start a thread

7. Doubled headline "sample / Into the Unknown" plus a "Preview" badge (both; phone stacks it on three lines).
8. Five run chips before typing; on phone they overflow and "Changes since br… @ v…" truncates to noise.
9. Resume links show three identical "Fake thread title" entries (the fake provider titles every thread the same,
   but nothing in the row disambiguates them: no project, time or status).
10. Project picker lists `~/.dsh/no-folder` first and shows full absolute temp paths.

### Journey 2 — threads in parallel

11. The first capture of **All threads** showed "Loading threads…" with "Active (0)" while five threads existed; it
    filled after ~4 s. Sidebar default view is filtered ("Filter: Not running · Needs attention · Main threads").
12. Board and sidebar duplicate the same filters, project picker and grouping; the board has a horizontal scrollbar at
    1440 px with only four columns.
13. A hover action strip (6 icons) covers the row title ("Fake thr…") on hover; during capture the "Seeded thread to
    rebase" row ended up **Pinned** — most likely an automated click landing on that strip (unverified, but it shows
    how close row actions sit to the title).

### Journey 3 — answer a question

14. **Not reproducible in scratch.** The fake provider called `ask_user_question` (the `user-questions` reach
    `answered-question-stays-closed`), but the turn ended as "1 other tool call" with no question card; the reach's
    own `expect text "Which layout should the release notes use?"` timed out. Either the reach drifted or the
    composition answers the call immediately; triage it with `maintain-verify-dsh`. The screenshots show the thread
    after that call.

### Journey 4 — review and land

15. Four surfaces for one outcome: the transcript card ("1 revision(s) ready to integrate into main", **Integrate into
    main**), Changes strip, Thread integration (**Integrate**, **Integrate all (1)**), Jujutsu graph, pulls.review.
16. **pulls.review is not tied to the thread being reviewed**: it opened on `thread-51f809` ("no changes since main")
    instead of the seeded thread with the change.
17. Thread integration files a *ready* workspace under **Needs attention 1**; "1 workspace(s)", "1 user mess…"
    truncation; on phone the green summary card wraps to one word per line.
18. Raw error copy in the transcript: `llm-deepseek: no API key for provider route "deepseek-official"; store
    DEEPSEEK_API_KEY …` plus a `MISSING_CREDENTIAL` code (it does offer **Add or fix credentials**).
19. Jujutsu and pulls.review headers print the full absolute temp path of the repository.

### Journey 5 — what needs me

20. **Counters disagree:** Activity shows a red "1 attention" badge while Backlog › Inbox says "Nothing needs you" and
    the sidebar shows a green "2" on the Done filter.
21. Activity rows show raw ids: "2× status change for session-5cb4bdee-…".
22. Backlog toolbar truncates "Search ite[ms]" and wraps "Last update" onto two lines at 1440 px; on phone it is
    icon-only.

### Journey 6 — find a past thread

23. Palette thread rows are indistinguishable when titles repeat (initials avatar "SA", project, date `04/11/2026`,
    "Idle"); the prefix hint is truncated ("Type ? for prefixes: < backlog, thread:/session: search, > com…").

### Journey 7 — configure

24. AI Accounts: the account reads **Connected** while "Identity not reported by provider" and "No models returned
    yet. Sign in, then refresh the provider catalog." Two separate rows "DeepSeek" and "DeepSeek Account".
25. MCP Servers uses a centred narrow column unlike every other page.
26. Secret Catalog: "1 aliases"; on phone the name column truncates to "GITHUB_TO…" and the masked value runs into
    the copy icon.
27. Settings lists AI Accounts twice (core section and Plugins list); plugin entries mix cases ("agent-loop",
    "bash-sandbox", "Dshx plugin market…"); a DSH update notice sits inside General. On phone the rail's "⋯" button
    shows a "Settings" tooltip over the content.

### Journey 8 — cost and usage

28. **Usage history** shows "Quota history could not be loaded." with no recovery action, directly above Current
    limits that did load (both).
29. Two dashboards (Usage analytics, AI Accounts usage history) plus the sidebar card, composer meter, Requests tab and
    per-message "Usage 0 tok"; the Usage request log counts "Failed 1" while every listed row says OK.

### Dark mode

30. Dark mode renders consistently on the three screens; no unreadable text found. The "Integrate into main" button
    inverts to white, the only light block on the page.

## Which destinations are used (usage_activity_report, 30 days)

`usage_activity_report` (days 30) has data only from 2026-10-29 to 2026-11-04 and records **agent tool and skill
calls, not UI navigation**: there is no page-view or click telemetry for destinations. 5,802 calls: 5,314 built-in
tools, 346 plugin API tools, 61 MCP, 47 skills.

Plugin-owned agent tools by calls, as a weak proxy for which capabilities are exercised (by agents, not the user):

| Owner | Calls | Tools |
| --- | --- | --- |
| memory | 41 | `memory_search` |
| preview | 59 | `preview_click`, `preview_screenshot`, `preview_open` |
| multi-host | 18 | `multi_host_exec` |
| project-checks | 15 | `project_checks_actions` |
| settings-shell | 15 | `settings_list` |
| references | 13 | `reference_save` |
| thread-sidebar | 13 | `project_list` |
| backlog | 21 | `backlog_capture`, `backlog_list` |
| jj-integration | 15 | `jj_thread_status`, `jj_thread_destination` |
| background-jobs | 6 | `background_jobs_wait` |

Usage, AI Accounts, Activity, Traces, MCP Servers and Secret Catalog have no entries in the top 40. **Conclusion:** the
data cannot decide rail membership (Phase 0 acceptance item). It does show agents use Knowledge (memory, references)
and Work (backlog) tools regularly, which argues against folding Knowledge away on this evidence alone. Deciding from
real UI use needs a client-side navigation counter (for example a `destination opened` span in traces); record that
as a Phase 3 input.

## How it was captured

Workspace `ade-baseline` (`/Users/tbrowang/Documents/dshfiles-threads/ade-baseline`).

```sh
pnpm exec turbo run build --filter=@dshfiles/dshx
pnpm exec turbo run build --filter='./plugins/@dshfiles/*' --concurrency=6   # `dev up` alone failed: agent-toolkit
                                                                             # could not resolve command-palette's dist
export DSHX_DSH_EXECUTABLE="$(cd node_modules/@deepseek-ai/dsh && pwd -P)/lib/bin.js"   # `dsh` is not on PATH here
D="node tooling/dshx/packages/dshx/dist/cli/bin.js dev"
$D up --name ade-baseline --skip-build --fake-secret-cli --idle-timeout 60 --timeout 300000
$D doctor --name ade-baseline
# doctor: FAIL host-log "10 entries did not activate" (sessionQuery/sessionController pending at boot);
# they activated moments later — every page and seed below worked.

# Seeds (catalog reach steps):
$D open home-screen --name ade-baseline                                    # seed rebase-ready-thread
$D open user-questions/answered-question-stays-closed --name ade-baseline  # seed tool-call-thread + ask_user_question
                                                                           # (last expect failed, see journey 3)
# Extra data through the WebKit driver: two composer threads (one with an isolated workspace) and two backlog
# captures ("bug: export button overlaps the footer on phone", "idea: race one prompt across two models").

# Screens (WebKit; the driver reads the launch URL from the mode-600 state file and never prints it):
bash capture/journeys.sh desktop
bash capture/journeys.sh phone
bash capture/journeys.sh dark 01-start; bash capture/journeys.sh dark 04a; bash capture/journeys.sh dark 08a
# phone retries: 02 via "Expand sidebar"; 03, 04a and 06 via the rail's "Search threads" → palette
$D down --name ade-baseline
# compression: magick <f> [-resize 75% for phone] -colors 128 PNG8:<f>
```

[`capture/phone.mjs`](<capture/phone.mjs>) is the WebKit driver (a subset of the catalog reach grammar plus `nav`
for rail destinations behind the overflow menu, `names`, `wait`). [`capture/journeys.sh`](<capture/journeys.sh>)
lists every journey's steps. Both hard-code this run's workspace and state-file paths; edit them before reuse. Future
phases should prefer adding these paths as catalog `reach` steps and a `--viewport`/`--browser webkit` option to
`dshx dev` (it is Chromium 1440×900 only today) — that is the reason a separate driver was needed.

Not attempted: the quota-blocked thread seed (`quota-blocked-thread` has no catalog reach that uses it, and a temporary
catalog entry was not picked up), so the AI Accounts "Usage limit" continuation group is not in the baseline.
