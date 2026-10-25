# Model selection

![Choose a model before typing](docs/screenshots/draft-model-selection.png)

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-model-selection` from
stock DSH **0.2.1-rc.2**, tag `dsh-v0.2.1-rc.2` (commit
`687f282e8625c6b8d11ff58211a90524be2e4317`), upstream
[`packages/client/ui-model-selection`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/ui-model-selection).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

The native directory requires a Host model-selection projection before becoming
ready and sends every choice to `session.selectModel`. A new client-only blank
has neither a Host Session nor its projection. This fork owns the same native
`modelDirectories` runtime service, full model/effort menu, label slot, keyboard
behavior, provider catalogs and `/model` contribution. Both entry points still
use one per-Session directory; this is not a second picker or a proxy of native
state. There are no private cross-package imports or core patches.

For local blanks, the directory derives its current selection from the public
`@dshfiles/session-controller/draft-client` service (`SessionDraft.model`, falling
back to the loaded catalog default). `select()` calls `stageModel()` first. A
successful stage updates both entries locally without any selection RPC. The
draft owner applies staged selection before the first prompt and retains draft
metadata until the send. A false stage result keeps native Host RPC/projection
behavior unchanged. Reconnect resets the catalog, never the staged draft.

The shared catalog remains the native global `modelCatalog()` response. A
preset-specific initial route must be staged by the draft owner; this package
does not invent preset defaults. Addressed subagents remain unavailable exactly
as in stock DSH.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row
`ui-model-selection` and inserts `dshfiles-model-selection`. Add the owned bundle
to the desired profile together with the updated `@dshfiles/session-controller`;
profile activation is opt-in (this contribution changes no profile). The client
requires `sessionDrafts`, so activate the updated draft owner rather than mixing
this client with an older controller. The Host half is the native no-op.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json).
Vendored files stay byte-identical except:

| File                                    | Owned delta                                                                                                                                |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| [directory.ts](src/native/directory.ts) | Subscribe to the public draft list; stage local choices without RPC; resolve local defaults without projection; clean up the subscription. |
| [service.ts](src/native/service.ts)     | Inject `sessionDrafts` and pass it to the single directory owner.                                                                          |
| [index.ts](src/native/index.ts)         | Require the draft service before activating the native surfaces.                                                                           |

On a DSH upgrade, inspect upstream changes, preserve the native public service and
all surfaces, reapply only these deltas, and run:

```sh
node scripts/native-fork-diff.mjs model-selection
pnpm --dir plugins/@dshfiles/model-selection typecheck
pnpm --dir plugins/@dshfiles/model-selection test
pnpm --dir plugins/@dshfiles/model-selection build
node -e "import('./plugins/@dshfiles/model-selection/dist/index.js')"
```

No new UI classes are introduced: the native CSS module and primitives remain
unchanged. The canonical `./client` export is the generated dshx Loader entry;
consumers use the supported `ctx.modelDirectories` runtime service, not class
imports from this package.

## Verification

[Focused directory tests](tests/draft-selection.test.ts) cover local catalog
readiness without projection, model+effort staging without RPC, reconnect
retention, shared changes, unavailable routes, materialization handoff and
unchanged real-Host projection ownership. The real-client journey is
`thread-sidebar.pretyping-draft-choices` in
[project-header-chat.feature](../../../tooling/dshx/e2e/features/project-header-chat.feature).

The screenshot above is captured by that journey in a disposable stock-core
profile. Before typing, it selects another catalog model and Creator mode, then
checks there is still no Host Session. The first send verifies creation, model
selection and prompt ordering. A second journey covers the existing compact
model picker. No live instance is used or restarted.
