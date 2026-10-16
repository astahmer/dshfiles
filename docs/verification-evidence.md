# Verification evidence

Project Checks is the authoritative owner of trusted-action receipts. Activity Timeline provides a read-only, replayable summary for cross-session discovery; it does not become a second receipt store or run checks itself.

## Receipt projection

Project Checks validates a strict version-1 summary and emits it on `dshfiles/activity/event` only after the durable receipt write succeeds. The event uses `id: verification:${receiptId}` and `correlationId: receiptId`; stable identity makes live delivery and bounded backfill idempotent. Activity Timeline validates and deduplicates the event before storing it.

The projection includes only receipt/session/action identity, a bounded label, status and failure category, timestamps and duration, exit code, manual/automatic mode, attempt and verification turn, and recorded before/after source revisions. It excludes command text and arguments, working paths, process output, environment, credentials, prompts, and transcript content. Project Checks continues to run only profile-trusted fixed argv inside a canonical trusted root through the Host-managed subprocess boundary; a failed or absent timeline cannot fail or rerun the action.

Passed receipts are routine and may be condensed. Failures and timeouts remain individually visible for attention. Cancellation is `cancelled` with `failure: null`, shown as notable rather than as a failed check. Automatic retries retain one receipt and one event per attempt. Backfill reads Project Checks' own retained receipt table, is bounded to seven days and 2,000 rows, and shares the live event identity. Project Checks retains at most 30 receipts per Session and 2,000 total; Activity Timeline retains at most 5,000 events.

A timeline item is historical evidence, not proof that the current working copy or action configuration still matches. Before/after revisions are recorded facts; current source freshness is read from Project Checks. Configuration equivalence remains `unknown`. A historical Activity item may outlive its bounded source receipt and says so rather than promising full details. Native hook invocation/result records remain separate; absent hook events are not labeled “skipped.”

## Session navigation

For `Open Session`, Activity Timeline first reads the public Workspace Controller snapshot. It fails closed while the Workspace list phase is pending, rejects IDs in the complete `archivedSessionIds` set, then requires the Session ID to be in the Host Session list before calling `uiWorkspace.openSession`. Archived or absent IDs use the same visible “archived or unavailable” message. This path is read-only: it does not archive, unarchive, create, wake, or message a Session.

The browser journey archives the owning Session using the core Workspace UI, switches to Archived only, hovers the row to confirm `Unarchive session` is available, and never clicks that action. It then hides archived rows, opens the historical Activity item, and verifies the unavailable alert, no active Session row, and no composer. The E2E composition stays limited to Activity Timeline, Project Checks, and workspace-folder-picker; it does not load ThreadSidebar just to display that plugin's separate archived-thread banner.

The missing-ID branch is the same fail-closed Session-list check and user-facing unavailable message. The installed `ISessions` contract has no delete operation, so no supported UI path can create an orphaned Session for a browser test; no storage mutation or test-only delete capability is introduced. Browser E2E covers the archived case, while the missing-ID behavior is represented by the shared read-only guard rather than claimed as a separate UI test.

## Security review and runtime caveats

The review covered the receipt allowlist and strict schemas, persistence-before-emission ordering, Project Checks path/process boundary, diagnostics, dependency provenance, and Activity Timeline navigation. The Workspace Controller dependency is pinned to the installed DSH `0.2.0-rc.2` API and declares the Client injection explicitly.

- **Critical:** none found.
- **Warning:** none found.
- **Note — missing-ID browser coverage:** the [navigation guard](../plugins/@dshfiles/activity-timeline/src/panel.tsx#L215-L237) rejects archived and unlisted IDs before `openSession`. The [browser journey](../tooling/dshx/e2e/support/plugin-journeys/verification-evidence.steps.ts#L151-L177) proves the archived path, including that the Unarchive action is not clicked. The installed `ISessions` API has no delete operation, so there is no supported way to create a missing-ID fixture without storage mutation. Impact: no separate missing-ID UI E2E. Remediation: keep the shared read-only guard; add a browser case if the public API later gains a safe removal path.
- **Note — pending snapshot:** the same [navigation guard](../plugins/@dshfiles/activity-timeline/src/panel.tsx#L215-L227) fails closed when Workspace state is not ready. Impact: a transiently pending snapshot temporarily prevents opening Sessions. Remediation: add a focused pending-state test if a supported test seam becomes available; no browser test currently forces this phase.
- **Note — activation:** the [package manifest](../plugins/@dshfiles/activity-timeline/package.json#L30-L87) and [Client composition](../plugins/@dshfiles/activity-timeline/src/client.tsx#L23-L39) add the Workspace Controller dependency and injection. An active profile must load the updated bundle; manifest changes take effect after a Host/profile restart. Verification used disposable named scratch profiles only; the live `127.0.0.1:3080` profile was not synced or restarted.

The `tool-call-thread` scratch seed accepts ThreadSidebar's `New thread` button or the core DSH button displayed as `New Session` (accessible name `New session`). This Activity Timeline verification omits ThreadSidebar because its Host entry remains pending on the `workspaces` service in the stock scratch profile; the Activity Timeline does not depend on it. Multi-host is loaded only to avoid its optional `/threadList` 404s.

## Verification

Run from the repository root with the pinned Node and pnpm:

```sh
fnm exec --using=22.23.3 pnpm install --frozen-lockfile
fnm exec --using=22.23.3 pnpm --dir plugins run contract
fnm exec --using=22.23.3 pnpm --dir tooling/dshx run features:check
TURBO_FORCE=1 fnm exec --using=22.23.3 pnpm check:e2e @dshfiles/activity-timeline
TURBO_FORCE=1 fnm exec --using=22.23.3 pnpm check:e2e @dshfiles/project-checks
```

Each changed plugin can also be verified with `pnpm typecheck`, `pnpm test`, `pnpm build`, and `node -e "import('./dist/index.js')"` from its package directory. The forced browser suites cover the Activity Timeline feed/manual/archive path (3/3) and Project Checks trust-root, freshness, retry, optional-timeline, and cancellation paths (5/5).

The Activity Timeline `verification-receipts` reach is exercised in an isolated named scratch DSH. Build dshx once for the checkout if its CLI bundle is absent or stale:

```sh
fnm exec --using=22.23.3 pnpm --dir tooling/dshx --filter @dshfiles/dshx build
dshx() { fnm exec --using=22.23.3 node "$PWD/tooling/dshx/packages/dshx/dist/cli/bin.js" "$@"; }
dshx dev up --plugin @dshfiles/activity-timeline --plugin @dshfiles/project-checks --plugin @dshfiles/ai-accounts --plugin @dshfiles/workspace-folder-picker --plugin @dshfiles/multi-host --plugin @dshfiles/jj-integration --plugin @dshfiles/home --name verification-evidence --json
dshx dev doctor --name verification-evidence
dshx dev open activity-timeline/verification-receipts --name verification-evidence
dshx dev shot --label verification-receipts --name verification-evidence --json
dshx dev down --dry-run --name verification-evidence
dshx dev down --name verification-evidence
```

The reach selects the seeded “Agent started work” event and verifies `Open Session`. The final scratch shot reported zero console errors, page errors, failed requests, and HTTP errors; evidence is retained under `$TMPDIR/dshx-dev/verification-evidence/evidence/` after `down`.
