# Schedule

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-schedule` from stock DSH **0.2.1-rc.2**, tag
`dsh-v0.2.1-rc.2` (commit `687f282e8625c6b8d11ff58211a90524be2e4317`), upstream
[`packages/client/ui-schedule`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/ui-schedule).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

The Session header's reminder catalog builds a new `schedule/list` source each time a thread's header mounts, and a
catalog source drops its read when its last subscriber leaves, so opening a thread again (or the Tasks page) reads the
list again even when no task changed. The sources and their subscriptions are private to the package.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-schedule` and inserts `dshfiles-schedule`. The Host
half is the native no-op.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                                                              | Owned delta                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [catalog-source.ts](src/native/catalog-source.ts)                 | Optional `revision` dependency: a source subscribed again keeps its last successful read when the page-wide revision has not moved since; otherwise it reads as natively. |
| [index.ts](src/native/index.ts)                                   | One page-wide revision bumped by `schedule/changed` and `connection/reset`, registered before any source; one header source per Session for the page's life.              |
| [session-schedule-state.ts](src/native/session-schedule-state.ts) | Passes the revision to the per-Session source.                                                                                                                            |

While a catalog is subscribed it still rereads on every `schedule/changed` and reset, exactly as natively.

```sh
node scripts/native-fork-diff.mjs schedule
pnpm --dir plugins/@dshfiles/schedule typecheck
pnpm --dir plugins/@dshfiles/schedule test
pnpm --dir plugins/@dshfiles/schedule build
```

The vendored `src/native` directory is excluded from Oxlint and Oxfmt like the other forks. Upstream's browser specs
need `@deepseek-ai/dsh-client-test-runtime` and are not vendored; `tests/` covers the delta.
