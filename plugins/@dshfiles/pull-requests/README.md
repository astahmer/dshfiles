# Pull requests

Host-only GitHub integration that links a pull request to a DSH thread, watches it, and reports meaningful state changes through the thread sidebar. The plugin exposes these Agent tools:

- `pull_request_link` — link by GitHub.com PR URL, or by number and repository `cwd`.
- `pull_request_unlink` — remove one link by URL or repository plus number.
- `pull_request_list` — list one thread's links, or all links with `all: true`; includes last known state and watch status.
- `pull_request_watch` / `pull_request_unwatch` — start or stop watching; watch creates the link if needed, unwatch keeps it.

`sessionId` defaults to the calling thread. URL links use the Agent's current `cwd` when available; number links require `cwd` so `gh repo view` can identify the repository. An empty stored `cwd` means no calling directory was available; polling still uses `--repo` explicitly.

## Runtime behavior and limits

- Uses the installed `gh` executable and its existing login. It never reads, prints, or stores an authentication token. Only GitHub.com PR URLs are accepted; GitHub Enterprise hosts are not supported.
- Watching polls immediately, then every two minutes. Multiple linked threads watching the same repository and PR share one `gh pr view` per poll. Links, last-known state, and rate-limit backoff persist in the Host `StorageDomain`.
- Polling requests `state,mergeable,mergeStateStatus,reviewDecision,statusCheckRollup,comments,reviews`. New comment/review messages contain only author and timestamp, not user-authored text.
- The `gh pr view` status rollup does not separately identify required versus optional checks. The “checks passed” transition is therefore conservative: GitHub must report `mergeStateStatus: CLEAN`, at least one status entry must be present, and every returned entry must be successful. It does not claim a separately enumerated branch-protection check set.
- Rate limiting applies persisted exponential backoff starting at two minutes and capped at one hour. Other CLI or schema failures retain the last known state and retry on a later cycle.
- On merge or close, watching stops and the plugin asks `thread-sidebar` to settle the linked thread. Auto-settle can skip running, waiting, blank, archived, pinned, opted-out, or descendant-active threads. If `thread-sidebar` is absent, pull-request state continues updating and the Host logs that message/settle integration was unavailable.

## Verification

From the repository root:

```bash
pnpm --dir plugins/@dshfiles/pull-requests test
pnpm --dir plugins/@dshfiles/pull-requests typecheck
pnpm --dir plugins/@dshfiles/pull-requests lint
pnpm exec turbo run build --filter=@dshfiles/pull-requests
node plugins/@dshfiles/pull-requests/scripts/host-import-check.mjs
```

The Host API and durable storage path run against a real disposable test Host; schema and transition tests use fixed GitHub-shaped JSON and do not contact GitHub. A browser journey is intentionally not applicable because this plugin adds no client surface.
