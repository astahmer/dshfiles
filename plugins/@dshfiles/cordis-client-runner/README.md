# Cordis client runner

Owned whole-package fork of `@deepseek-ai/dsh-cordis-client-runner` from stock DSH **0.2.2-rc.1**, tag
`dsh-v0.2.2-rc.1` (commit `66491b05e3f05ad35bcdd4f6cd7ed26041d9e3db`), upstream
[`packages/extensions/cordis-client-runner`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.1/packages/extensions/cordis-client-runner).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

Each Client inspect provider registered at setup publishes the page's inspect manifest
(`dynamicCordisRunner/syncInspectManifest`) before the connection is up, and the first `connection/reset`, which the
gateway emits for the page's first connected generation too, publishes the same manifest again: two identical calls per
page load. The registry is private to the package.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `cordis-client-runner` and inserts
`dshfiles-cordis-client-runner`. The Host half is the native no-op. Other plugins (`ui-cordis`, its fork
[`@dshfiles/cordis-cards`](../cordis-cards)) import only types from this package and reach the runner through the
`dynamicCordisRunner` service, which the fork provides unchanged.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                            | Owned delta                                                                                                                                                             |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](src/native/index.ts) | Before the page's first connected generation the manifest sync is skipped; that generation's `connection/reset` publishes the complete manifest once, later ones again. |

```sh
node scripts/native-fork-diff.mjs cordis-client-runner
pnpm --dir plugins/@dshfiles/cordis-client-runner typecheck
pnpm --dir plugins/@dshfiles/cordis-client-runner test
pnpm --dir plugins/@dshfiles/cordis-client-runner build
```

The typecheck covers `src` and `tests` only: the dshx and Vitest configs pull in Node's `setTimeout` typing, which the
vendored browser timer does not satisfy. The vendored `src/native` directory is excluded from Oxlint and Oxfmt like the
other forks.
