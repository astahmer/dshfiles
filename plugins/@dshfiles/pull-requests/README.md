# Pull requests

![Create a GitHub pull request from a thread](docs/screenshots/github-pull-request-create.png)

Forge integration that creates a pull request or merge request from a DSH thread, links it to the thread, watches it, and reports meaningful state changes through the thread sidebar. GitHub uses `gh`; GitLab uses `glab` behind the same forge port (`src/forge-port.ts`), so link, watch, create and the composer `#` picker work on both. In the browser, the command palette's **Create pull request from this thread** opens a dialog: it previews the repository, bookmark, base and commits, shows a title and body drafted from the thread that you can edit, lists every blocker with its fix, and pushes and creates only when you confirm. The result links the pull request to the thread and starts watching it. The plugin exposes these Agent tools:

- `pull_request_link` — link by GitHub PR URL or GitLab merge-request URL, or by number and repository `cwd`.
- `pull_request_unlink` — remove one link by URL or repository plus number.
- `pull_request_list` — list one thread's links, or all links with `all: true`; includes last known state and watch status.
- `pull_request_watch` / `pull_request_unwatch` — start or stop watching; watch creates the link if needed, unwatch keeps it.
- `pull_request_create_preview` — read-only preview of opening a PR from a thread's jj workspace: repository, base branch, bookmark, the commits above `<base>@<remote>`, a title and body drafted from the thread, an open PR that already uses the bookmark, and every blocking problem with its recovery.
- `pull_request_create` — after the preview, with `confirm: true` and the preview's `headCommitId`: sets the bookmark on that commit, runs `jj git push --remote <remote> --bookmark <name>`, then `gh pr create` (or reuses the open PR for the bookmark), and links and watches the PR on the thread.

## Creating a pull request from a thread

The preview changes nothing. It reads the thread's directory from its stored header and its title from the title index; only when the model drafts the description does it read the conversation (a bounded window of the newest messages and the last model route). It runs `gh auth status`, `gh repo view` and `gh pr list --head`, and reads jj: the remote (`origin` first), the base branch (`gh`'s default branch at that remote), and the commits from `<base>@<remote>` to the working copy (an empty, undescribed working-copy commit is skipped). The bookmark is an existing local bookmark on the head commit, else `dsh/<thread-title-slug>`.

The title and body come from one model call on the thread's own route (or a passed `provider`/`model`). Without a model service, a route or a usable answer, the draft falls back to the commit messages and `generation.note` says why.

Create reads only the thread's directory (none at all when `cwd` is passed), never its conversation. It re-checks everything and refuses when the workspace head is no longer the previewed commit, so a confirmed preview is exactly what is pushed. Every blocker carries a recovery:

| Problem                                                        | Recovery offered                                                                     |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| gh missing / not signed in / no GitHub repository              | install gh, `gh auth login`, or add the GitHub remote                                |
| jj missing / not a jj workspace / no remote / base not fetched | install jj, run from a jj workspace, `jj git remote add`, `jj git fetch`             |
| no commits, undescribed or conflicted commits                  | commit the work, `jj describe` or `jj abandon` the empty one, `jj resolve`           |
| bookmark points elsewhere, push rejected                       | choose another name or `--allow-backwards`; fetch and rebase, or fix Git credentials |
| `gh pr create` failed after the push                           | the branch is pushed; retry, or open it on GitHub and `pull_request_link` it         |

`sessionId` defaults to the calling thread. URL links use the Agent's current `cwd` when available; number links require `cwd` so `gh repo view` can identify the repository. An empty stored `cwd` means no calling directory was available; polling still uses `--repo` explicitly.

## Runtime behavior and limits

- Uses the installed `gh` (GitHub) or `glab` (GitLab) executable and its existing login. It never reads, prints, or stores an authentication token. GitHub Enterprise hosts are not supported; any https GitLab host is.
- GitLab: a bare `owner/name` repository key is GitHub (the same keys older records hold), and a dotted first segment names a forge host (`gitlab.com/group/sub/project`). Repository and merge-request URLs are parsed strictly (https only, no userinfo, `/-/merge_requests/<n>`); other hosts are refused with a message naming the supported forges. `glab mr view --output json` is decoded into the same normalized view the GitHub watcher stores: `detailed_merge_status`/`merge_status` map mergeability, `blocking_discussions_resolved` and conflicts map to BLOCKED, `head_pipeline.status` becomes one `pipeline` check entry, and `approvals_required` maps the review decision. `glab mr create --yes` creates the merge request; the push is the same `jj git push` as GitHub.
- Verify GitLab on a host with `glab` installed: `glab auth status`, then `pnpm --dir plugins/@dshfiles/pull-requests test` covers parsing and normalization, and `link`/`watch` need a real merge-request URL.
- Watching polls immediately. After that, Host events refresh a thread's watched pull requests within a debounce (3 seconds by default): a `jj git push`, `git push`, `gh pr create|merge|ready|close|reopen` or `glab mr …` command returning in that thread, the end of one of its turns, or a new link to a pull request that another thread watches. A pull request checked in the last 20 seconds is skipped, so a push and the turn end after it cost one read. A slow sweep polls every watched pull request every ten minutes by default as the fallback for changes made outside DSH. Multiple linked threads and backlog items watching the same repository and PR share one read per poll; every GitHub pull request of one pass is read in batched GraphQL calls (see [GitHub API budget](#github-api-budget)). Links, last-known state, and rate-limit backoff persist in the Host `StorageDomain`.
- Measured by the probe in `tests/refresh-triggers.spec.ts` (five watched pull requests, one hour, two pushes): the former two-minute sweep made 150 `gh pr view` calls and saw a push up to two minutes late; the event-driven watcher makes 32 and sees each push within the 3-second debounce.
- Settings (namespace `dshfiles-pull-requests`, applied live): `refreshOnThreadEvents` (default on; off leaves only the sweep), `eventDebounceSeconds` (default 3, 1–60), `sweepMinutes` (default 10, 1–120; lower it when event refresh is off), `githubPointsFloor` (default 500, 0–4,900; see below). Each burst and each sweep reads them again, so a change applies without a restart; a Host older than this namespace runs on these defaults.
- A full read takes `state`, `mergeable`, `mergeStateStatus`, `reviewDecision`, the head commit's check rollup (up to 100 checks), the latest 20 comments and reviews with their totals, and `body`. New
  comment/review messages contain only author and timestamp, not user-authored text. The first 16,384 characters of
  the description are kept with the last known state, so another plugin can read the closing references it names
  (`Closes b:k3f9`); a stored record written before that field simply has no description.
- GitHub's status rollup does not separately identify required versus optional checks. The “checks passed” transition is therefore conservative: GitHub must report `mergeStateStatus: CLEAN`, at least one status entry must be present, and every returned entry must be successful. It does not claim a separately enumerated branch-protection check set.
- A rate-limit error applies persisted exponential backoff starting at two minutes and capped at one hour, and stops the remaining batches of that pass. Other CLI or schema failures retain the last known state and retry on a later cycle; a pull request GitHub cannot answer (deleted, no access) fails alone while the rest of its batch still reads.
- On merge or close, watching stops after that one read, and the plugin asks `thread-sidebar` to settle the linked thread. Auto-settle can skip running, waiting, blank, archived, pinned, opted-out, or descendant-active threads. When `thread-sidebar` is loaded but the settle request fails, the link keeps watching and the next poll asks again; once it is settled (or when `thread-sidebar` is absent and nothing can settle it) the terminal pull request is never polled again. If `thread-sidebar` is absent, the Host logs that message/settle integration was unavailable.

## GitHub API budget

GitHub gives each account 5,000 GraphQL points an hour, shared with every `gh` call agents make. The watcher spends as
little of it as it can:

1. **Batched reads.** One `gh api graphql` call reads up to fifty pull requests with aliases (`p0: repository(…){pullRequest(number:…){…}}`), and the same query asks for `rateLimit { cost remaining resetAt }`.
2. **Fingerprint pass.** A pull request whose stored snapshot has a fingerprint is first read cheaply: `state`, `updatedAt`, `mergeable`, `mergeStateStatus`, `reviewDecision`, the head commit `oid`, its rollup state and its check counts by state. The digest of those fields is stored with the snapshot; when it still matches, nothing else is read and no transition can have happened. Check runs do not move `updatedAt`, so the head commit and check counts are part of the digest. Only the pull requests whose digest changed get the full read.
3. **Budget floor.** When a read reports fewer than `githubPointsFloor` points remaining (default 500), GitHub reads wait until the reported `resetAt`. An explicit `pull_request_watch` still reads once. `0` never waits.
4. **Terminal pull requests** stop after the read that saw them merge or close (above).

Measured by `tests/gh-call-budget.spec.ts`: a stub `gh` counts processes and charges points with GitHub's formula (requests each connection needs, summed, divided by 100, at least 1). GitHub charged the same costs live, for read-only queries against `cli/cli` on 2026-11-11: `gh pr view` = one query = 1 point; fifty aliases full = 2 points (71 KB), fifty aliases fingerprint = 1 point (11 KB).

| Watched pull requests | Before, per sweep (`gh pr view` each) | After, first sweep (full) | After, quiet sweep (fingerprint) | Before → after per hour at the 10 min sweep |
| --------------------: | ------------------------------------- | ------------------------- | -------------------------------- | ------------------------------------------- |
|                     5 | 5 spawns, 5 points                    | 1 spawn, 1 point          | 1 spawn, 1 point                 | 30 → 6 spawns, 30 → 6 points                |
|                    50 | 50 spawns, 50 points                  | 1 spawn, 2 points         | 1 spawn, 1 point                 | 300 → 6 spawns, 300 → 6 points              |
|                   300 | 300 spawns, 300 points                | 6 spawns, 12 points       | 6 spawns, 6 points               | 1,800 → 36 spawns, 1,800 → 36 points        |

A pull request that changed between sweeps adds one full read to its batch (one more spawn, 1–2 points per fifty).
Event refreshes cost the same per batch as a sweep; the 20-second minimum age still applies.

## Webhooks (optional, not wired)

Polling stays the only refresh path. A GitHub repository webhook could push refreshes instead of waiting for the sweep,
but only when GitHub can reach the Host: the DSH web server listens on a local address, so it needs a public URL or a
tunnel (`cloudflared tunnel`, `tailscale funnel`, `ngrok`). With one:

1. `@dshfiles/project-automations` already serves signed webhooks at `POST /automations/webhook/<id>` and verifies
   GitHub's `x-hub-signature-256` against a `secret:ALIAS` (its README covers limits and replay handling). Today such an automation starts a thread with a prompt; it does not refresh a watched pull request.
2. The wiring, proposed and not built: subscribe the repository webhook to `pull_request`, `pull_request_review`,
   `check_suite` and `issue_comment` (`issues` only matters to the backlog's issue states); map each delivery to
   `repository.full_name` plus `pull_request.number` (or `check_suite.pull_requests[].number`, or `issue.number` when
   `issue.pull_request` is set); refresh only pull requests already watched, through the same debounced batch read.
   Unknown pull requests are ignored, so a delivery can never add a watch.
3. It stays off by default and needs a secret reference setting plus the credential-port and web-server dependencies in
   this plugin. Batching and the fingerprint pass already cut a 300-watch hour to 36 points, so the webhook would buy
   latency, not budget.

## Watches owned by backlog items, and issue states

The published contract (`@dshfiles/pull-requests/api`) also serves Host plugins that keep forge state for something other than a thread. They are Host API methods, not Agent tools: the backlog decides what to watch.

- `watchFor({ owner: { kind: 'backlog-item', id }, url, cwd? })` watches a pull request or merge request for that owner. It is stored in its own `owned` table of the same storage domain (a domain stored before it opens with the table empty), polled by the same sweep and in the same batched read as the thread links of that pull request, and never prompts or settles a thread. A new watch polls at once unless a rate-limit backoff holds; then the sweep picks it up. Idempotent; a watch on a merged or closed pull request keeps its terminal state and is not polled again.
- `unwatchFor({ owner, url? })` releases one watch, or all of an owner's; `ownedWatches({ kind })` lists them with each last known state and `lastCheckedAt`.
- `issueStates({ urls })` reads up to 100 GitHub issues, fifty per `gh api graphql` call (`state` and `stateReason` only). An issue gh cannot answer (deleted, transferred) comes back in `failed` while the rest of its batch still reads; a rate limit stops the remaining batches and answers `rateLimited: true`, so the caller backs off. Nothing is stored here: the caller keeps what it read.
- The backlog uses both: each open item watches the pull requests it links and reads its linked issues on its own `revisionPollMinutes` pass (see the backlog README).

## Verification

From the repository root:

```bash
pnpm --dir plugins/@dshfiles/pull-requests test
pnpm --dir plugins/@dshfiles/pull-requests typecheck
pnpm --dir plugins/@dshfiles/pull-requests lint
pnpm exec turbo run build --filter=@dshfiles/pull-requests
node plugins/@dshfiles/pull-requests/scripts/host-import-check.mjs
```

`tests/create-host.spec.ts` creates a PR end to end against a real test Host, real jj and a temporary bare Git remote, with a shell-script `gh` on `PATH`, and checks the pushed branch, the `gh pr create` argv and the watched link. The Host API and durable storage path run against a real disposable test Host; schema and transition tests use fixed GitHub-shaped JSON and do not contact GitHub. The browser journey `tooling/dshx/e2e/features/pull-requests.feature` (`pnpm check:e2e pull-requests`) seeds a jj repository with a bare remote and a stub `gh` on the Host PATH, runs the palette command, confirms the dialog and checks the pushed branch and the created, polled pull request.
