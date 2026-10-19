# Backlog redesign (step 7)

Brief: the user's handoff of 2026-10-19 (Gr8r Studio quality, Linear issue handling, Discord capture,
agent-native). References: `~/Downloads/backlog-ui-reference-screenshots`, the "Agent inbox" board video.
Screenshots go to the user for approval before e2e journeys are written.

## Audit (what exists)

- Store, API, agent tools, triage (Jev + model), lifecycle signals, `@b:` mentions: keep; extend.
- Capture JSON error (`undefined` in the payload): fixed in the redesign of capture (status omitted, not
  `undefined`); failure restores the draft.
- Activity is the item's own event log; thread/jj activity lives in activity-timeline. The item log stays
  the source for item events; condensed summaries are derived, not stored.
- No motion or dnd library in the workspace; View Transitions (Chromium) animate moves and view switches.

## Model (backward compatible, optional fields decode with defaults)

| Axis              | Values                                                                                    | Notes                                                       |
| ----------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| Workflow `status` | inbox, todo, doing, done, dropped                                                         | unchanged                                                   |
| `attention`       | none, needs-input, blocked, waiting                                                       | set by agents or the user; drives Inbox; never goes dormant |
| Visibility        | fresh, stale, dormant, archived                                                           | derived; `dormantDays` per kind configurable, 0 = never     |
| `acknowledgedAt`  | time or null                                                                              | Inbox read state; unread ≠ requires action                  |
| `snoozedUntil`    | time or null                                                                              | hidden from Feed/Inbox until then, then resurfaces          |
| Link `relation`   | related, depends-on, blocks, duplicates, implements, fixes, discovered-from, discussed-in | default related                                             |
| Link `provenance` | user, agent, extracted, inferred                                                          | inferred links are shown as suggestions                     |

## Navigation (inside the plugin's main panel; the DSH sidebar stays untouched)

Header: title, segmented views **Feed · Inbox · Items · Board · Projects**, search, New.

- **Feed** — Discord channel: chronological by last activity, newest at the bottom next to the composer,
  day separators, one entry per item with a condensed activity summary (never one row per event).
- **Inbox** — attention queue: list (filters All / Needs you / Blocked / Suggestions) + inspector.
- **Items** — Gr8r "Tasks": dense grouped table, group by status/kind/project/attention, collapsible
  groups, multi-select bulk status, inline add per group.
- **Board** — "Agent inbox" video: compact cards that expand in place into their recent activity and
  actions; columns by status; pointer drag; View Transitions for moves and Board↔Items.
- **Projects** — grid derived from item projects (no manual administration): progress from real counts,
  agents, last activity; overview with active items, recent activity, linked threads and revisions.

## Inspector

Header (breadcrumb project / b:n, title, inline property chips), description, original capture,
relationships grouped by relation with provenance, conversation (comments + condensed activity),
comment composer. Side panel with an expand-to-full toggle; list state is kept.

## Composer

Chat-like, multiline, autogrowing; `#` tag and `@` item autocomplete; live triage chips; draft kept in
local storage; Enter sends instantly (optimistic), failure restores the draft with retry.

## Gaps closed after the first review (2026-10-19)

| Gap                                | Outcome                                                                                                                                                                                      |
| ---------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search had no ranking or reasons   | Weighted search with operators, match fields and snippets; saved views in settings                                                                                                           |
| Inbox ignored agent questions      | Linked failed/finished threads from thread-sidebar's attention API (setting `inboxThreads`); native `ask_user_question` forms stay out (cross-session scan is a Host gap)                    |
| Activity not shared                | Item log stays the source of truth (timeline is bounded and observation-only); backlog events published to the timeline (setting `publishActivity`); live thread state from the session list |
| Lists not virtualized              | Items virtualized, Feed paged, Board columns capped, revision-gated polling, Host-side project counts; measured on 2,017 items                                                               |
| Jev and model triage untested live | Jev checked live with the `jev-api-key-optmem` secret; its work question now counts bug reports as work. The model path is still unchecked: the free models refuse calls outside OpenCode    |

Open: see "Remaining" in [README.md](README.md).
