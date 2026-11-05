# @dshfiles/backlog-notion

Notion data sources as a [backlog](../backlog/README.md#remote-sync) sync source. This plugin is Host-only: it serves the
backlog's `backlog-provider` Host API (`BacklogProviders.contract('@dshfiles/backlog-notion')` from
`@dshfiles/backlog/backlog-provider`) and renders nothing. Its user-visible surface is **Backlog settings › Remote sync**,
owned and screenshotted by `@dshfiles/backlog`; with this plugin loaded, that section offers **Add Notion connection**.

## Set it up

1. In Notion, create an internal integration (or a personal access token), give it read content, update content,
   insert content and comment capabilities, and share the database with it.
2. In **Backlog settings › Remote sync**, add a Notion connection. Its key is a `secret:ALIAS` reference resolved on
   the Host through the Secret Catalog; empty falls back to the Host's `NOTION_API_KEY`. **Test** names the bot and its
   workspace and lists every data source the integration can see.
3. Add a binding. Its container is a data source id, a database id or `notion.so` URL (a database with one data
   source binds to it), or empty for the only data source the integration sees. Property names default to
   conventions; set the binding's provider settings when your database differs:

| Setting           | Property type    | Default                                                       |
| ----------------- | ---------------- | ------------------------------------------------------------- |
| Status property   | status or select | a property named Status, State or Stage, else the only status |
| Tags property     | multi-select     | Tags or Labels, else the only multi-select                    |
| Priority property | select           | Priority                                                      |
| Priority names    | `urgent=P0, …`   | P0–P3, Critical, High, Medium, Low, Lowest by name            |
| Parent property   | relation         | Parent item (Notion's sub-items) or Parent                    |

A named property that is missing or of the wrong type fails the binding with a message naming it.

## What maps to what

| Backlog   | Notion                                                                                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| title     | the title property                                                                                                                                                              |
| body      | the page as Notion-flavored Markdown (`markdown_version: v2`)                                                                                                                   |
| status    | status groups: To-do → todo (Inbox/Triage → inbox), In progress → doing, Complete → done (Canceled/Won't do → dropped); a select by name; the binding's remote status names win |
| tags      | multi-select option names (an existing option keeps its case; Notion creates new ones)                                                                                          |
| priority  | the select, through the priority names                                                                                                                                          |
| parent    | the first page of the parent relation                                                                                                                                           |
| comments  | page comments both ways (plain text in, markdown out)                                                                                                                           |
| delete    | deleting a linked backlog item sets `in_trash: true` on the page (unless the binding only pulls)                                                                                |
| reference | `notion.so` / `notion.site` page URLs and bare page ids                                                                                                                         |

Relations other than parent are not mapped. Status options cannot be created through the API, so a status the data
source has no option for is left unwritten; select statuses and priorities create their option.

## How it talks to Notion

- **Version.** Every request pins `Notion-Version: 2026-03-11`: data sources replaced databases as the query target in
  [2025-09-03](https://developers.notion.com/guides/get-started/upgrade-guide-2025-09-03) (`GET /v1/databases/:id`
  lists `data_sources`, queries go to `/v1/data_sources/:id/query`, pages are created with a
  `{ type: "data_source_id" }` parent), and [2026-03-11](https://developers.notion.com/guides/get-started/upgrade-guide-2026-03-11)
  renamed `archived` to `in_trash`. Bump it in `src/notion-client.ts` after reading the next upgrade guide.
- **Change feed.** Webhooks need a public HTTPS endpoint, so a binding polls: the query filters
  `last_edited_time` `on_or_after` the checkpoint, sorted ascending, 50 per page; the last page's newest timestamp is
  the next checkpoint. Notion rounds `last_edited_time` to the minute, so the checkpoint's minute is read again and a
  record's version adds a hash of its fields: two edits in one minute still count. A pull from no checkpoint is a full
  scan, so a page that left the data source (or went to the trash) removes its item.
- **Bodies.** Reads use [`GET /v1/pages/:id/markdown`](https://developers.notion.com/guides/data-apis/working-with-markdown-content).
  Writes send one `update_content` search-and-replace over the changed lines, widened until its `old_str` is unique,
  so blocks keep their ids and comments. Blocks the integration cannot see, or that a truncated read left out, show as
  `<unknown …/>`; an edit that would cover one is refused (`unsupported`) rather than deleting it, and child pages are
  never deleted (`allow_deleting_content` is not sent). New pages are created with `markdown`.
- **Rate limits.** Notion allows [an average of three requests a second per connection](https://developers.notion.com/reference/request-limits);
  requests of one connection are spaced 340 ms apart, and a 429 or 529 waits for `Retry-After` (capped at 60 s, three
  retries) and holds back that connection's next requests too.
- **Errors.** 401/403 ask to check the key, 404 asks to share the page or database with the integration, anything
  else carries Notion's message; the key never appears in an error, a log or a span. The failure reaches the backlog
  over its Host API with its code and status, so the sync chip shows this recovery, not a generic refusal.

## Telemetry

One `notion request` span per HTTP call, with `notion.operation` (`query-data-source`, `update-page-markdown`, …),
`http.request.method`, `http.response.status_code`, `notion.retries` and `error.type` — no URL, page id or key. The
backlog's `backlog sync` and `backlog sync item` spans wrap them, and the `backlog-provider` API dispatch is traced
automatically.

## Develop

```sh
pnpm --dir plugins/@dshfiles/backlog-notion test        # Effect tests against an in-memory Notion (src/notion-fake.ts)
pnpm --dir plugins/@dshfiles/backlog-notion build
```

Another provider (Jira, P8 of the backlog v2 plan) follows the same shape: a client service owning auth, version
pinning, rate limits and the span; a pure mapping module; a provider factory implementing `BacklogProvider`; a fake
server answering the provider's paths; and `describe.bindingOptions` for per-binding settings.
