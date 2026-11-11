# Deliverables

Owned whole-package fork of `@deepseek-ai/dsh-client-ui-deliverables` from stock DSH **0.2.1-rc.2**, tag
`dsh-v0.2.1-rc.2`, upstream
[`packages/client/ui-deliverables`](https://github.com/deepseek-ai/deepseek-harness/tree/dsh-v0.2.1-rc.2/packages/client/ui-deliverables).
The original MIT notice is retained in [LICENSE](LICENSE).

It renders the turn's "Edited N files" card, the changed-files review tab, the delivery cards and the closing-prose
file mentions, exactly as the native row does.

## Why fork the native row?

The card and the review tab answer every binary file with "Binary file; changes cannot be shown", and the comparison
component and its routes are private to the package: no slot reaches them.

## Composition

[cordis.patch.yml](cordis.patch.yml) disables stock Loader row `ui-deliverables` and inserts `dshfiles-deliverables`.
Both halves are forked: the Host half registers the same routes and system-prompt section as the native one.

## Native delta and updates

Provenance and path mappings live in [native-fork.json](native-fork.json). Vendored files stay byte-identical except
the recorded delta.

```sh
node scripts/native-fork-diff.mjs deliverables
pnpm --dir plugins/@dshfiles/deliverables typecheck
pnpm --dir plugins/@dshfiles/deliverables test
pnpm --dir plugins/@dshfiles/deliverables build
```

The vendored files are excluded from Oxlint and Oxfmt like the other forks. Upstream's specs need
`@deepseek-ai/dsh-client-test-runtime` and are not vendored; `tests/` covers the delta.
