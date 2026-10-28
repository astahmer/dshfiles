# Local milestone verification

Verified on stock DSH 0.2.1-rc.2 with official Node 22.23.3 and the system Chrome. Verification uses disposable homes and synthetic references; the live profile is not installed, restarted or modified.

## Focused proof

- `pnpm --dir plugins/@dshfiles/resource-packs test`: real temporary SQLite and Cordis Host tests, plus React UI tests. They cover all nine types, retained detach/reattach data, reopen, additive schema changes, readonly ownership, independent contributor unload, optimistic revisions and transaction rollback. The contributor calls the exported dshx API rather than private store methods.
- `pnpm --dir plugins/@dshfiles/resource-packs typecheck`: strict workspace TypeScript passes.
- `pnpm exec oxlint --deny-warnings --report-unused-disable-directives plugins/@dshfiles/resource-packs/src plugins/@dshfiles/resource-packs/tests tooling/dshx/e2e/support/plugin-journeys/resource-packs.steps.ts`: zero warnings/errors, using the repository rules rather than scaffold overrides.
- Build both `@dshfiles/resource-packs` and `@dshfiles/ui-styles`; import the Host, API and model JavaScript entries with the pinned Node. All pass.
- Validate this catalog with `DshxFeatureCatalogSchema` and check both referenced scenario tags. Both pass.

## Real browser journeys

Run with `DSHX_DSH_EXECUTABLE` pointing to the absolute installed **stock** core executable and `DSHX_CHROMIUM_EXECUTABLE` to the system browser:

```sh
DSHX_E2E_SCENARIO_CACHE=0 pnpm check:e2e resource-packs
```

Both scenarios pass, without scenario-cache replay:

1. Attach Tracking to a conversation and file reference, edit status/assignee/date, reload, detach with confirmation and reattach without losing values.
2. Create a Review pack through the GUI, attach it, edit Reviewer and reload the custom schema/value.

Both scenarios also check 360, 480, 768 and 1024 px viewports with the sidebar collapsed: the document stays within the viewport and the table region can actually scroll. The showcase capture uses the populated first scenario. [View the capture](screenshots/local-properties.png).

The diagnostics assertion admits only Chromium's exact `eventsource net::ERR_ABORTED` cancellation occurring during the scenario's explicit reload interval. Other request failures, HTTP failures, console errors and page errors remain failures. This does not alter the shared recorder or hide a product error.

A separate `dshx dev up --plugin @dshfiles/resource-packs`, `doctor`, `open resource-packs/local-properties` and `shot` passes against the final bundles: all three tested bundles activate, the Host log has no errors, and the capture reports zero console/page/request/HTTP errors and zero warnings. `down` removes the owned scratch processes, home and private token-bearing state.

## Known baseline and boundaries

- The broad workspace contract reports the existing `user-questions` missing test script; no resource-packs contract error is reported.
- The repository-wide feature check reports the existing `agents/agent-mention-preview` missing browser scenario. This plugin's catalog and both scenarios pass separately.
- The browser-task drift check reports an existing `traces` generated-task change, intentionally left out of this feature.
- React 18 unit tests expose the existing shared `plugin-ui` DialogOverlay ref warning. Production browser journeys and scratch captures have no console errors. Node prints the expected experimental SQLite notice.
- The whole repository suite, live activation and native navigation to a real private conversation are not claimed as verified. Reference-click payloads and refusal behavior are covered by UI tests; the opener uses the installed native Session service and refuses missing/archived IDs.
- Notion, remote synchronization, per-resource sharing, immutable file identities and automatic workflows are not implemented by this milestone.
