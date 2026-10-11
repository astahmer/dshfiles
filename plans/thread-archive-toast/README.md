# Thread archive undo notice

## Objective

Show the archive confirmation as a compact overlay anchored to the thread sidebar, so it does not move the list and can be undone immediately. Verify the UI and generated Controller contract in isolated workspaces before any web-profile promotion. Never restart the live DSH instance.

## Acceptance

- [x] Keep transient notices out of list flow; retain persistent warnings in flow.
- [x] Assert archive notice overlay positioning and unchanged scroll-pane top in the browser journey.
- [x] Generate Controller declarations from local Session/Controller sources while keeping canonical Cordis/Typert identity; repeat generation deterministically.
- [x] Refresh plugin lockfile and pass frozen plugin/DSHX installs and DSHX build.
- [ ] Pass complete plugin gates and isolated archive undo browser journey; record browser evidence.
- [ ] Promote the owned bundle to web only after all required checks pass; leave restart to the user.

## Progress

| Milestone | State | Evidence |
| --- | --- | --- |
| Toast overlay and layout regression | Complete | Existing absolute bottom overlay; browser step now checks computed position and scroll-pane top. |
| Controller generation | Complete | `sync:core-api-session-controller` generated 166 outputs twice with the same SHA-256 `07c452d64df6bea7a576a0188ac525ab582b9a23833a3ca190cd85d1e1d34124`. |
| Build and focused checks | Complete | Frozen installs pass; Session and DSHX builds pass; thread-sidebar typecheck and 94 tests pass; host bundle imports. |
| Full plugin gates and isolated browser journey | In progress | Run the full plugin gates, then generate and run archive E2E on a disposable profile. |
| Conditional web promotion | Pending | Do not sync until checks are green; never restart `127.0.0.1:3080`. |

**Resume here:** finish the full plugin checks, generate and run the isolated archive-undo E2E journey with screenshot/computed-style evidence, then decide whether the all-green result meets the requested web-promotion gate.
