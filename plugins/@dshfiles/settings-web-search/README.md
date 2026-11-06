# Settings web search

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-settings-web-search` from stock DSH **0.2.1-rc.2**, tag
`dsh-v0.2.1-rc.2` (commit `687f282e8625c6b8d11ff58211a90524be2e4317`), upstream
[`packages/client/ui-settings-web-search`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/ui-settings-web-search).
The original MIT notice is retained in [LICENSE](LICENSE).

## Why fork the native row?

The native page builds its card controller at boot and reads the web-search credential with `credentials/describe`
right away, then once per settings scope (three of them) each time the settings document is described again: seven
identical reads on a fresh load of the live GUI, for a page that only shows under Settings › Plugins. The controller
and its subscriptions are private to the package, so no slot can reach them.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-settings-web-search` and inserts
`dshfiles-settings-web-search`. The Host half is the native no-op. The bundle is listed in the `profiles/web` seed; an
existing live profile picks it up on its next reconcile and Host restart.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta below.

| File                                                                      | Owned delta                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [web-search-card-controller.ts](src/native/web-search-card-controller.ts) | The boot read, the per-scope reads and `credentials/reference-updated` go through `requestCredential()`: a changed reference is forgotten at once, as natively, and the read runs once per burst (once quiet for 50 ms, at most 250 ms after it began) while the card subscribes, or once when it shows again. Saving a key still re-reads directly. |
| [demand-refresh.ts](src/native/demand-refresh.ts)                         | Owned (no upstream file): the observed store the card binds and the coalesced, demand-gated trigger (same file as in `@dshfiles/settings-models`).                                                                                                                                                                                                   |

On a DSH upgrade, inspect upstream changes, reapply only the recorded deltas, and run:

```sh
node scripts/native-fork-diff.mjs settings-web-search
pnpm --dir plugins/@dshfiles/settings-web-search typecheck
pnpm --dir plugins/@dshfiles/settings-web-search test
pnpm --dir plugins/@dshfiles/settings-web-search build
node -e "import('./plugins/@dshfiles/settings-web-search/dist/index.js')"
```

The vendored `src/native` directory is excluded from Oxlint and Oxfmt like the other forks. Tests replace the native
primitives' settings-form model (that package cannot load under Node here); the credential reads under test do not
depend on it.
