# Schedule

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-schedule` from stock DSH **0.2.2-rc.1**, tag
`dsh-v0.2.2-rc.1` (commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`), upstream
[`packages/client/ui-schedule`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1/packages/client/ui-schedule).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

A catalog source drops its read when its last subscriber leaves, so opening the Tasks page or a thread header again
reads the Host catalog again even when no task changed. The sources and their subscriptions are private to the package.
Since 0.2.2-rc.1 upstream serves the Session header from the one shared `schedule/catalog` source (it no longer builds a
per-Session `schedule/list` source), so the former per-Session source cache is gone; only the revision gate remains.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-schedule` and inserts `dshfiles-schedule`. The Host
half is the native no-op.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                                                              | Owned delta                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [catalog-source.ts](src/native/catalog-source.ts)                 | Optional `revision` dependency: a source subscribed again keeps its last successful read when the page-wide revision has not moved since; otherwise it reads as natively. |
| [index.ts](src/native/index.ts)                                   | One page-wide revision bumped by `schedule/changed` and `connection/reset`, registered before the shared catalog source, which receives it.                               |

While a catalog is subscribed it still rereads on every `schedule/changed` and reset, exactly as natively.

```sh
node scripts/native-fork-diff.mjs schedule
pnpm --dir plugins/@dshfiles/schedule typecheck
pnpm --dir plugins/@dshfiles/schedule test
pnpm --dir plugins/@dshfiles/schedule build
```

The vendored `src/native` directory is excluded from Oxlint and Oxfmt like the other forks. Upstream's browser specs
need `@deepseek-ai/dsh-client-test-runtime` and are not vendored; `tests/` covers the delta.
