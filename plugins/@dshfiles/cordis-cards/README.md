# Cordis cards

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-cordis` from stock DSH **0.2.2-rc.2**, tag
`dsh-v0.2.2-rc.2` (commit `ddac96760b6edf8fa0fe17cbdcf0b512f4c12b2c`), upstream
[`packages/extensions/ui-cordis`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.2-rc.2/packages/extensions/ui-cordis).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

The Cordis panel and cards read the Host's dynamic-plugin inventory (`dynamicCordisRunner/inventory`) at setup, before
the connection is up, then the first `connection/reset`, which the gateway emits for the page's first connected
generation too, discards that read and reads again: two identical calls per page load. The inventory store is private
to the package.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-cordis` and inserts `dshfiles-cordis-cards`. The
Host half is the native no-op.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                            | Owned delta                                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [index.ts](src/native/index.ts) | The inventory read waits for the page's first connected generation, whose `connection/reset` then needs no reset or reread (later ones still reset and reread). The `cordis-panel` registration states the default `priority: 0` so the dshx build accepts the fork taking that stock cell. |

```sh
node scripts/native-fork-diff.mjs cordis-cards
pnpm --dir plugins/@dshfiles/cordis-cards typecheck
pnpm --dir plugins/@dshfiles/cordis-cards test
pnpm --dir plugins/@dshfiles/cordis-cards build
```

The typecheck covers `src` and `tests` only, like [`@dshfiles/cordis-client-runner`](../cordis-client-runner). The
vendored `src/native` directory is excluded from Oxlint and Oxfmt like the other forks.
