# Verification evidence — remaining data boundaries

The receipt projection, bounded backfill, attention handling, Session navigation, and scratch-browser journey have shipped. Their current behavior and prior verification record live in the [verification-evidence guide](../docs/verification-evidence.md), [Project Checks README](../plugins/@dshfiles/project-checks/README.md), and [Activity Timeline README](../plugins/@dshfiles/activity-timeline/README.md). This plan now tracks only gaps found in the updated codebase; this refresh inspected checked-in source on 2026-10-25 and did not rerun tests or touch the live profile.

## Current shipped baseline

- Project Checks owns bounded receipts, records before/after revisions, recalculates source freshness, and stores a `verificationStage` of `manual`, `completion`, or `rebase`. Configuration equivalence deliberately remains `unknown`; no command/argument fingerprint is stored.
- Project Checks emits its strict v1 summary after persisting the authoritative receipt. Activity Timeline validates, deduplicates, retains and backfills it; failed/cancelled status mapping and fail-closed Session navigation have scratch E2E coverage.
- Remote check execution now records an executor and fallback details. The receipt schema and v1 Activity summary also carry fields that the Activity view does not need; see the open data-minimization gate below.
- The checked-in workspace now pins DSH packages at `0.2.1-rc.2`; earlier verification notes against `0.2.0-rc.2` are historical, not a fresh runtime claim.

## Open work

1. **Minimize peer details at the Activity boundary.** The Project Checks producer sends remote `sshTarget` and `workspace` in the v1 Cordis payload even though the Activity adapter discards them before persistence. It also sends `remoteFailure.message`; the adapter stores this stderr-derived, bounded message in Activity detail. Narrow the cross-plugin envelope to fields the timeline needs (for example, executor kind/remote ID and a safe failure code); do not send peer paths/targets or unreviewed stderr-derived text. Review where the same message is persisted or returned by Project Checks as well. Preserve richer diagnostics only at an explicitly reviewed, access-appropriate boundary. Update the versioned contract with deliberate old-event compatibility.
2. **Make verification stage inspectable.** Project Checks receipts distinguish `manual`, `completion`, and exact-candidate `rebase`, but the current panel and Activity summary show only manual/automatic and attempt. Show the stored stage in both views where present; render legacy receipts without a stage as “not recorded” rather than inferring it.
3. **Add regression evidence.** Test both the raw producer event and persisted Activity event with unique sentinels in `sshTarget`, `workspace`, and peer stderr; assert the Activity boundary omits them while retaining the safe remote ID/failure category. Cover all stage values, legacy receipts with no stage, and version compatibility. Add a scratch-browser journey for a peer fallback and a rebase-stage receipt if the existing E2E fixture can reach those flows without a real remote host.
4. **Update owning docs and catalogs.** Record the narrowed fields and stage semantics in both plugin READMEs, `docs/verification-evidence.md`, feature catalogs, and E2E scenario text. Repeat the targeted security review after the boundary changes.

## Acceptance criteria

- [ ] No SSH target, peer workspace path, or unreviewed stderr-derived message crosses into the Activity producer payload or persisted Activity detail.
- [ ] Project Checks retains the appropriate diagnostic facts without exposing command output, credentials, or untrusted peer paths through an unreviewed API/tool result.
- [ ] Activity and Project Checks show `manual`, `completion`, or `rebase` when recorded; legacy receipts remain readable and display “not recorded.”
- [ ] Strict-schema tests prove safe and unsafe peer-field combinations, old receipt compatibility, event deduplication, and truthful status/attempt mapping.
- [ ] Scratch E2E proves the visible peer/stage facts and the redaction boundary without contacting a physical host or touching the live `:3080` profile.
- [ ] Documentation matches the current `0.2.1-rc.2` workspace pins and labels prior runtime/test evidence as historical where applicable.
