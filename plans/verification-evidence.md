# Verification evidence plan

## Context

- The checked-in web profile composes both `@dshfiles/project-checks` and `@dshfiles/activity-timeline`.
- Project Checks owns profile-trusted, fixed-argv actions; it verifies the session directory is inside the configured root, uses the Host-managed subprocess boundary, does not expose child output, and persists bounded per-session receipts. Receipts include status, reason, start/finish/duration, exit code, source revision, automatic/manual, verification turn, and attempt. Retention is bounded to 30 receipts per Session and 2,000 total.
- Project Checks already has a composer panel showing recent receipts and hook invocation/result projections for the selected Session. It is session-scoped, so users must already know which thread to open. Current receipts capture a post-run source revision and recalculate current freshness on read; they do not preserve both before/after revisions or detect a changed action configuration that reused the same action ID.
- Activity Timeline already owns the cross-session chronological feed, persistence, event deduplication, filters, search, attention view, and read-only Agent tools. It accepts producer events through the Cordis event `dshfiles/activity/event` and requests bounded replay through `dshfiles/activity/backfill`. It currently receives agent lifecycle, communication, jj integration, and workspace events; Project Checks does not publish receipts into it.
- The Client contract `uiWorkspace.openSession(SessionTarget)` is available for opening a known Session from a feed item. The timeline README documents deep navigation as deferred; this must be tested before a plan claims working click-through.
- Repo E2E artifacts are a separate developer/CI evidence product. Usage Analytics tracks model request/token/cost/latency rather than subprocess checks and is not part of the web profile. Neither should become a second owner for Project Checks receipts.
- DSH 0.2 records only native `hook/invoked` and `hook/result` session-log events. It does not provide durable skipped/unsupported hook events; missing records must stay “not reported,” never be labeled “skipped.” See the [Project Checks behavior](../plugins/@dshfiles/project-checks/README.md), [Activity Timeline design](../plugins/@dshfiles/activity-timeline/README.md), [end-to-end testing strategy](../docs/e2e-testing.md), and the [existing reference-feature ledger](reference-feature-additions.md).

## Goal

Let the user find recent trusted check results across Sessions in the existing Activity Timeline, understand the safe facts each result proves, and open its owning Session for the existing detailed Project Checks view.

## What

Extend the existing evidence owners; do not create a new dashboard or move check state:

1. Project Checks remains the authoritative receipt store and the only owner that knows whether/how an action ran.
2. After a receipt is durably saved, Project Checks emits one bounded, validated activity summary with stable identity derived from the receipt ID.
3. When Activity Timeline requests backfill, Project Checks replays retained receipts newer than the requested cutoff. Timeline's existing stable-ID deduplication makes replay safe.
4. Activity Timeline displays run status, check label, timestamp, duration, automatic/manual, attempt, and the recorded source-revision fact. Failures/timeouts that need attention are individually visible; successful checks may be condensed.
5. A timeline item can open its associated Session using the existing public Client navigation contract. Full receipt details and manual actions remain in the existing Project Checks panel.
6. Improve the receipt's source/config evidence only where the data is authoritative and safe. Do not store or publish raw command output, stderr, environment values, prompts, or unredacted command arguments.

## Why

The per-session Project Checks panel already answers “what checks are configured here?” and “what are the recent results in this Session?” The missing task is “which recent Sessions have failures or checks worth reviewing?” The Activity Timeline is already the user's cross-session attention surface and the receipt store already contains the authoritative result. A small summary projection closes that discoverability gap without duplicating storage or creating a competing verification system.

## How

### Conceptual model

```text
trusted action / awaited turn-stopping verification
  └─ Project Checks Host
       ├─ runs fixed argv through ctx.subprocess
       ├─ persists authoritative bounded receipt
       └─ emits safe receipt summary (stable receipt-derived id)
              └─ Activity Timeline validates, deduplicates, persists, condenses
                   ├─ Activity panel + attention filter
                   ├─ activity_timeline_* read-only Agent tools
                   └─ open owning Session → existing Project Checks panel

Activity Timeline startup ── backfill(since) ──► Project Checks receipt table
```

The Activity Timeline is a projection, not an independent check database. If it is absent, disabled, unavailable, or fails ingestion, the check and receipt still succeed. Backfill is read-only and bounded by Project Checks retention and the Activity Timeline's requested cutoff.

### Operations / behavior

- On manual or automatic action completion, persist the receipt first. Only a successfully persisted receipt can produce an activity event.
- Emit one idempotent summary with `sessionId`, a stable ID derived from the receipt UUID, and `correlationId` equal to that receipt identity. Use the existing activity event channel and the existing `integration` source unless implementation shows a source-specific event type is necessary.
- Keep the event payload deliberately small: outcome, action label/id, timestamp, duration, whether automatic, attempt/verification turn, and safe revision evidence. Omit command/args, paths not already needed by the UI, stdout/stderr, credentials, environment, and conversation content.
- Treat passed as routine/notable according to feed noise; failed and timed-out results as attention; cancellation as a separate, non-failure outcome. A missing event or failed backfill is not evidence that a check failed or was skipped.
- At timeline startup, replay bounded retained receipts whose `finishedAt` is within the existing backfill window. Stable IDs deduplicate repeated startup/retry delivery. Never read another plugin's state file; use the Project Checks Host's own storage table.
- The feed detail shows facts from the receipt. Current freshness must be obtained from the Project Checks API when details are requested; a historical “passed” event must not imply the checked working copy is still current.
- Selecting the Session reference uses the public `uiWorkspace.openSession` service. If the Session is archived/missing or navigation fails, surface that limitation; do not mutate/revive it. Leave the per-session Project Checks overlay as the detailed source and run-action surface.
- Keep native hook invocation/result rows separate from action receipts. Continue showing “not reported” when the Host supplies no skipped/unsupported event.

### Tech choices

| Choice                     | Decision                                                                                                                   | Rationale                                                                                                       |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Receipt ownership          | Existing Project Checks storage/API                                                                                        | It already validates and retains the authoritative run outcome.                                                 |
| Cross-session discovery    | Existing Activity Timeline                                                                                                 | It already supplies durable events, search, attention filtering, deduplication, and read-only tools.            |
| Producer/consumer boundary | Cordis `dshfiles/activity/event` + bounded `dshfiles/activity/backfill`                                                    | Matches existing jj/communication producer pattern and avoids importing another plugin's storage.               |
| Event identity             | Deterministic ID derived from the persisted receipt UUID; receipt UUID as correlation ID                                   | Safe replay and deduplication without inventing a second run identity.                                          |
| UI                         | Activity summary + Session navigation; existing Project Checks overlay for full details                                    | Extends current user workflow instead of adding another dashboard.                                              |
| Receipt output             | Status and bounded metadata only; no process output                                                                        | Existing privacy boundary deliberately avoids command stdout/stderr and secrets.                                |
| Revision evidence          | Store/label start and finish revisions separately if needed; preserve old records                                          | A single post-run revision cannot explain a changed-source run. Do not call wall-clock time a content identity. |
| Action-config identity     | Investigate a nonsecret action fingerprint; otherwise report freshness as unknown when config equivalence cannot be proven | Same action ID can be reconfigured; do not persist raw command/arguments merely to detect that change.          |

### Architecture

The projection stays unidirectional:

```text
project_checks.receipts (authoritative)
        │ typed safe event after durable write
        ▼
Activity Timeline ingestion (validate → dedupe → bounded persist)
        │
        ├─ UI summary/attention item
        └─ read-only agent activity tools

backfill request ──► Project Checks reads its own bounded table ──► same safe event
```

No event emitted before receipt persistence. If event ingestion is unavailable, Project Checks does not fail or rerun the action. Replaying the same receipt is harmless. The activity summary references its Session and receipt identity, not the full subprocess or Session log.

## What this allows

- Find failures and timeouts across multiple Sessions from the current Activity panel or its attention-only view.
- See what the check result means without opening every Session.
- Open the owning Session and use its existing Project Checks view for current freshness and the complete bounded receipt list.
- Recover recent summaries after an Activity Timeline restart without a second source of truth.
- Ask an Agent for read-only activity summaries through existing Activity Timeline tools.

## What this does not allow

- A new verification dashboard, CI test-run browser, or replacement for repository E2E artifact reports.
- Persisting or displaying stdout/stderr, arbitrary command/argument strings, environment values, credentials, prompts, or full session transcripts.
- Inferring “skipped” or “unsupported” hooks from missing native events.
- Changing which actions are trusted, allowing project files to configure actions, or changing turn-stopping/retry semantics as part of the projection.
- Treating an old passing receipt as proof that the current working copy still passes.
- Making Activity Timeline required for manual or automatic Project Checks operation.

## UI & UX

### Desktop

Activity Timeline shows a concise entry such as “Typecheck failed · automatic · attempt 2 · 8.2 s.” Detail shows completion time, exit/failure category, recorded revision evidence, and the owning Session. Failed/time-out entries appear in attention; successful runs are individually inspectable in detailed mode and may be condensed in the default feed. “Open session” selects the Session through `uiWorkspace.openSession`. The existing composer Project Checks panel remains the detailed receipt list and action control.

### Mobile

No mobile-specific panel is added. Keep the same bounded summary and session navigation usable in the existing responsive web surface; verify it at narrow viewport in the browser journey if the current layout supports that viewport.

### Common interactions

| Action                    | Result                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Open Activity Timeline    | Search/filter across recent activity; check results are ordinary integration events.                               |
| Choose attention-only     | Failed and timed-out receipts appear individually. Cancellation is not mislabeled as a failed test.                |
| Expand a successful run   | See the bounded recorded result; no raw subprocess output is exposed.                                              |
| Open related Session      | Navigate to its existing conversation; Project Checks panel remains the source for full receipt/current freshness. |
| Restart Activity Timeline | Backfill recent retained receipts; stable event IDs prevent duplicate rows.                                        |
| Disable Activity Timeline | Checks still run and receipts remain available in the per-session Project Checks panel.                            |

## Data model

Project Checks retains the authoritative receipt. A new activity summary is a derived projection:

```text
VerificationReceipt (existing owner)
  id, sessionId, actionId, label
  status, failure, startedAt, finishedAt, durationMs, exitCode
  sourceRevision (legacy post-run identity)
  automatic, verificationTurn, attempt
  + optional sourceRevisionBefore/sourceRevisionAfter
  + optional safe action-config fingerprint after security review

ActivityEvent (existing owner)
  id = stable receipt-derived id
  source = integration
  type = verification result type
  sessionId = receipt.sessionId
  correlationId = receipt.id
  summary/detail/metadata = bounded safe receipt facts only
```

Schema/data migration must accept existing stored receipts. The feed does not copy a second complete receipt table. If a receipt has aged out of Project Checks retention while an Activity Timeline summary remains, show that its detail is no longer available; do not imply the event links to a complete record forever.

## Implementation steps

1. **Pin down event contract and safe fields.** Add tests for mapping every receipt status to event type/level and confirm event payloads omit stdout/stderr, raw argv, cwd, environment, credential values, and prompt text. Decide how Activity Timeline labels check events without treating routine passes as attention.
2. **Strengthen receipt provenance narrowly.** Add before/after source revisions if useful for explaining `source-changed`; preserve the old field and load older rows. Review whether action configuration can be fingerprinted without including secret-bearing values. Until that is proven, report config freshness as unknown rather than claiming equivalence.
3. **Emit after durable receipt persistence.** Add an optional, versioned check-summary event to the existing Cordis event contract. Stable receipt-derived ID and correlation make retries idempotent. Activity Timeline absence or ingestion error must not change the action result.
4. **Add bounded startup backfill.** On the existing backfill request, project retained Project Checks rows newer than `since`, using the same mapping and event IDs as live emission. Test source boot order, repeated requests, 2,000-row cap, and timeline's 5,000-event retention.
5. **Render and navigate.** Add check-specific summary labels/status/attention treatment to the Activity detail. Use `uiWorkspace.openSession` to open an available owning Session; leave full details/actions in the existing Project Checks panel.
6. **Add a real browser journey.** In a scratch profile with both plugins, run harmless synthetic manual pass/fail and automatic verification retry cases. Verify live events, attention filtering, detail fields, Session navigation, restart backfill, deduplication, stale freshness, and disabled/missing timeline behavior.
7. **Update feature catalogs and docs.** Describe this as receipt projection in the existing Activity feed. Keep native-hook records and repository CI evidence explicitly separate. Update both plugins' feature catalogs and user-facing documentation after the behavior passes scratch acceptance.

## Open questions

1. Should successful receipts be condensed by default or individually visible until the user has a sample workload? Default to routine/condensed, with detailed mode preserving every retained event.
2. Can a safe action-configuration fingerprint include the command/argv fields without creating a secret oracle? If not, keep config freshness unknown unless DSH supplies a trustworthy immutable configuration revision.
3. Should activity summaries remain visible after the source receipt is trimmed? The event may remain for the Activity retention window, but must say the source receipt expired and must not promise full detail.
4. Does clicking a timeline result need to open the exact receipt overlay, or is opening its owning Session and using the existing Project Checks panel enough? Start with Session navigation unless browser validation proves a small exact-receipt route is necessary.

## Acceptance criteria

- [ ] A completed action produces exactly one persisted authoritative receipt and one safe Activity event; stable-ID replay/backfill does not create duplicates.
- [ ] Receipt persistence succeeds even when Activity Timeline is disabled or event ingestion fails; no action is rerun because projection failed.
- [ ] Manual, automatic, failed, timed-out, cancelled, and retry outcomes remain distinct and truthful. Failures/timeouts are individually visible in attention; cancellation is not presented as a failed check.
- [ ] The Activity summary identifies the Session, check label, result, time/duration, manual/automatic status, attempt, and recorded revision evidence without copying full command/args, process output, environment, credentials, prompts, or transcript content.
- [ ] Current freshness is recalculated from the Project Checks source when details are requested; an old passing projection cannot appear to certify the current working copy.
- [ ] Existing receipts load after any schema addition; stale, unavailable, or expired evidence is labeled rather than guessed.
- [ ] Opening a timeline result navigates to its owning live/available Session through the inspected Client API; a missing Session fails visibly without waking, messaging, or mutating it.
- [ ] Replaying a bounded backfill after timeline restart restores recent receipt summaries once and respects receipt/event retention caps.
- [ ] Missing Activity Timeline leaves Project Checks fully usable; missing native hook events are never labeled “skipped.”
- [ ] Scratch browser E2E covers the integrated journey and no live web profile is synced or restarted for verification.

## Decisions log

| Date       | Decision                                                    | Rationale                                                                                                                     |
| ---------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| 2026-10-16 | Extend Project Checks + Activity Timeline; no new dashboard | Both are already composed, have distinct ownership, and expose the needed persistence/feed boundaries.                        |
| 2026-10-16 | Persist receipt before emitting its activity projection     | A timeline failure must never erase or alter the actual check result.                                                         |
| 2026-10-16 | Keep hook receipts and repository E2E evidence separate     | Native skipped-hook events are unavailable, and CI artifact evidence has a different owner/lifecycle than per-Session checks. |
| 2026-10-16 | Do not claim currentness from a historical pass             | Source revision and current freshness have different semantics; freshness comes from the authoritative Project Checks API.    |
