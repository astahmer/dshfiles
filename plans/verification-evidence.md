# Verification evidence — browser proof of peer and stage facts

The data-boundary work is done: the v2 receipt event carries no peer `sshTarget`, `workspace` or failure message,
Activity Timeline still decodes v1 and drops those fields before storage, and both Project Checks and the Activity
summary show the verification stage (`not recorded` for legacy receipts). Behavior, unit and sentinel evidence, and the
security follow-up live in the [verification-evidence guide](../docs/verification-evidence.md), the
[Project Checks README](../plugins/@dshfiles/project-checks/README.md) and the
[Activity Timeline README](../plugins/@dshfiles/activity-timeline/README.md). What remains is browser evidence.

## Open work

1. **Re-run the verification-evidence journey** (`pnpm check:e2e @dshfiles/activity-timeline`). It now also asserts `"verificationStage": "manual"` on the manual receipts and
   `"completion"` on the completion attempts. It was not run with that change (memory pressure; the journey restarts a
   scratch Host and is listed as failing at a native-sidebar step in [ADE UX](ade-ux/README.md)).
2. **Peer fallback and rebase-stage receipts in the browser.** Add a scratch journey showing a peer-fallback receipt
   (remote ID and failure code visible, no target, path or stderr) and a `rebase` stage receipt, if the E2E fixture can
   reach those flows without a real remote host. Otherwise record why and keep the unit sentinels as the proof.

## Acceptance criteria

- [ ] Scratch E2E proves the visible stage facts for manual and completion receipts.
- [ ] Scratch E2E proves a peer fallback and a rebase-stage receipt with the redaction boundary, or the plan records
      why the fixture cannot reach them, without contacting a physical host or touching the live profile.
