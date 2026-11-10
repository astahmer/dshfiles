# Settings subagent

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-settings-subagent` from stock DSH **0.2.1-rc.2**, tag
`dsh-v0.2.1-rc.2` (commit `687f282e8625c6b8d11ff58211a90524be2e4317`), upstream
[`packages/client/ui-settings-subagent`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/ui-settings-subagent).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

With subagent model selection enabled, the page's controller reads `session/modelCatalog` at boot, before the
connection is up, then again on the first `connection/reset`, and never shares a read with the model selector: three
full Host catalog rebuilds per page load. The controller is private to the package.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-settings-subagent` and inserts
`dshfiles-settings-subagent`. The Host half is the native no-op.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                                                                                                  | Owned delta                                                                                                                                                                                          |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [subagent-model-selection-card-controller.ts](src/native/subagent-model-selection-card-controller.ts) | The catalog read waits for the page's first connected generation, which then needs no reread (later resets still reset as natively), and goes through `joinPageRead('remote:session/modelCatalog')`. |
| [index.ts](src/native/index.ts)                                                                       | Tells the controller whether the connection already has a generation, and routes `connection/reset` through `connectionReset()`.                                                                     |

```sh
node scripts/native-fork-diff.mjs settings-subagent
pnpm --dir plugins/@dshfiles/settings-subagent typecheck
pnpm --dir plugins/@dshfiles/settings-subagent test
pnpm --dir plugins/@dshfiles/settings-subagent build
```

The vendored `src/native` directory is excluded from Oxlint and Oxfmt like the other forks.
