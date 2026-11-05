# @dshfiles/backlog-jira

Jira Cloud projects as a [backlog](../backlog/README.md#remote-sync-connections-bindings-and-providers) sync source. This
plugin is Host-only: it serves the backlog's `backlog-provider` Host API
(`BacklogProviders.contract('@dshfiles/backlog-jira')` from `@dshfiles/backlog/backlog-provider`) and renders nothing.
Its user-visible surface is **Backlog settings › Remote sync**, owned and screenshotted by `@dshfiles/backlog`; with
this plugin loaded, that section offers **Add Jira connection**.

## Set it up

1. Create an [API token](https://id.atlassian.com/manage-profile/security/api-tokens) for the Atlassian account the
   backlog should act as, and store it in the Secret Catalog.
2. In **Backlog settings › Remote sync**, add a Jira connection: its key is the token's `secret:ALIAS` reference
   (empty falls back to the Host's `JIRA_API_TOKEN`), its API base URL your site, `https://<site>.atlassian.net`
   (https is required; plain http is accepted only on loopback, for tests), and its **Account email** the account's
   email (empty falls back to `JIRA_EMAIL`). **Test** names the account and lists every project it can browse.
3. Add a binding. Its container is a project key (`ENG`), or empty for the only project the account sees. The binding's
   provider settings:

| Setting                   | Default                           | Use                                                                                                |
| ------------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------- |
| Extra JQL                 | none                              | A clause ANDed to `project = "ENG"` (`labels = backlog`); an issue that leaves it reads as removed |
| Issue type for new items  | `Task`                            | The issue type **Create in Jira** uses                                                             |
| Priority names            | Highest, High, Medium, Low        | `urgent=P0, high=P1, …` for a custom priority scheme                                               |
| Status for deleted items  | a Won't Do-like status, else Done | The status a deleted backlog item moves its issue to                                               |
| Acceptance criteria field | none                              | A custom field id (`customfield_10050`) holding the criteria                                       |
| Summary field             | none                              | A custom field id holding the item's summary                                                       |

The binding's remote status names (`doing` → `In Review`) pick an exact status; without one, a status of the right
category is used.

## What maps to what

| Backlog             | Jira                                                                                                                                 |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| title               | `summary`                                                                                                                            |
| body                | `description` (ADF) as markdown                                                                                                      |
| status              | the status category: To Do → todo (Triage/Inbox → inbox), In Progress → doing, Done → done (Won't Do, Cancelled, Declined → dropped) |
| kind                | issue type Bug → bug, anything else → task (read only)                                                                               |
| tags                | `labels` (spaces become dashes: Jira labels cannot hold them)                                                                        |
| priority            | the priority name, through the priority names; `none` is never written (most schemes require a priority)                             |
| parent              | `parent` (epics and sub-tasks); cleared with `update.parent.set.none`                                                                |
| relations           | issue links: Blocks (blocks / depends-on), Relates (related), Duplicate (duplicates); other link types stay untouched                |
| due                 | `duedate` (date only)                                                                                                                |
| acceptance criteria | the configured custom field: list items `[x] text` (a task list's DONE items read as met); a text field gets lines                   |
| summary             | the configured custom field (ADF for a paragraph field, a string for a text field)                                                   |
| comments            | issue comments both ways, ADF ↔ markdown                                                                                             |
| delete              | a transition to the status for deleted items (unless the binding only pulls); Jira issues are never deleted                          |
| reference           | `ENG-12`, `https://<site>.atlassian.net/browse/ENG-12`, or a URL with `selectedIssue=ENG-12`                                         |

## How it talks to Jira

- **API.** Jira Cloud REST v3. Every path is built from a validated issue key (`ENG-12`) or numeric id; a project key
  must be letters, digits and underscores, and custom field ids `customfield_<n>`, so nothing a remote or a user typed
  reaches a path or the project clause unchecked. Identity is
  [`GET /rest/api/3/myself`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-myself/#api-rest-api-3-myself-get)
  (its display name, never its email), discovery
  [`GET /rest/api/3/project/search`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-projects/#api-rest-api-3-project-search-get).
- **Auth.** [Basic auth with the account email and an API token](https://developer.atlassian.com/cloud/jira/platform/basic-auth-for-rest-apis/),
  resolved on the Host; the token and the email never appear in an error, a log or a span.
- **Change feed.** Webhooks need a public HTTPS endpoint, so a binding polls
  [`POST /rest/api/3/search/jql`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-search/#api-rest-api-3-search-jql-post)
  with `nextPageToken` paging, 50 issues a page; the older `/rest/api/3/search` is
  [being removed](https://developer.atlassian.com/changelog/#CHANGE-2046). The query is
  `project = "ENG" AND updated >= "yyyy-MM-dd HH:mm" ORDER BY updated ASC, key ASC`. JQL dates have
  [minute precision and are read in the user's time zone](https://support.atlassian.com/jira-software-cloud/docs/jql-fields/#Updated),
  so the checkpoint (the newest `updated` instant seen) is written in the `timeZone` `/myself` reports, and its own
  minute is read again; a record's version adds a hash of its fields, so two edits in one minute still count. A pull
  from no checkpoint is a full scan, so an issue that left the project (or the extra JQL) removes its item.
- **Status.** Jira statuses cannot be set; they are reached through
  [`GET` then `POST /rest/api/3/issue/{key}/transitions`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issues/#api-rest-api-3-issue-issueidorkey-transitions-get).
  The planner takes a direct transition to the target (the binding's status name, else a status of the target category
  whose name reads as it), else hops through a status of a category in between (To Do → In Progress → Done), then a
  status of the same category, never through one already visited, up to three hops. An unreachable target fails with
  `unsupported`, naming the statuses that are reachable, so the binding's status name can be fixed. A project without a
  Won't Do-like status reachable keeps a dropped item at Done.
- **Bodies.** Descriptions, comments and paragraph custom fields are
  [Atlassian Document Format](https://developer.atlassian.com/cloud/jira/platform/apis/document/structure/).
  `src/jira-adf.ts` converts paragraphs, headings, bullet and ordered lists (nested, with a start number), code
  blocks, blockquotes, rules, hard breaks, and bold, italic, strikethrough, inline code and links both ways; any other
  node (a table, a panel, a mention, media) is kept as its text and reported. Before a write, both sides are compared
  as they read back after a trip through ADF, so markdown written another way (`*` bullets, `*em*`) is not re-sent and
  never ping-pongs. Rewriting a description that held a table or panel replaces it with its text: turn off description
  sync for such projects.
- **Links.** Issue links are read from `issuelinks` (the link type's outward description names what this issue does
  to `outwardIssue`).
  [`POST /rest/api/3/issueLink`](https://developer.atlassian.com/cloud/jira/platform/rest/v3/api-group-issue-links/#api-rest-api-3-issuelink-post)
  creates a link from `inwardIssue` to `outwardIssue` (`{ Blocks, inwardIssue: A, outwardIssue: B }` reads "A blocks
  B"); a removed relation deletes its link.
- **Rate limits.** Jira answers [429 with `Retry-After`](https://developer.atlassian.com/cloud/jira/platform/rate-limiting/)
  when a limit is hit; requests of one connection are spaced 100 ms apart, and a 429 or 503 waits for `Retry-After`
  (capped at 60 s; exponential backoff without one, three retries) and holds back that connection's next requests too.
- **Errors.** 401/403 ask to check the email, token and project access, 404 asks to check the key and the account's
  access, other refusals carry Jira's `errorMessages` and field `errors`. Every failure reaches the backlog over its Host
  API with its code and status.

## Telemetry

One `jira request` span per HTTP call, with `jira.operation` (`search-issues`, `transition-issue`, …),
`http.request.method`, `http.response.status_code`, `jira.retries` and `error.type` — no URL, site, key, email or token.
The backlog's `backlog sync` and `backlog sync item` spans wrap them, and the `backlog-provider` API dispatch is traced
automatically.

## Develop

```sh
pnpm --dir plugins/@dshfiles/backlog-jira test     # against an in-memory Jira (src/jira-fake.ts)
pnpm --dir plugins/@dshfiles/backlog-jira build
```

The fake answers the same paths the provider calls: project `ENG`, a workflow with a two-hop path to Done and a dead
end, issues with ADF descriptions, links, comments and custom fields, `nextPageToken` paging, JQL dates read in
`Asia/Kolkata`, and 429s on demand. The e2e journey (`tooling/dshx/e2e/features/backlog-jira.feature`) serves it on
loopback through the connection's base URL.

Unverified against a live site: the `POST /issueLink` direction (`inwardIssue` is the link's source) and the
`update.parent.set.none` clear follow the REST reference; one real-token smoke test is owed.
