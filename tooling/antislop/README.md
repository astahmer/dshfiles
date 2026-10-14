# Antislop rules

Vendored generated Oxlint plugin from the owned `emilint` repository, revision
`2bb430dd5e46572f101642224def4179e3a78f96`. Update from its source and rebuild
there; do not edit this bundle. Existing findings remain warnings during the
quality pass; correctness checks remain errors.

`ast-grep/rules/` holds emilint's ast-grep rules from the same revision, also
unedited; `sgconfig.yml` at the root points at them. `pnpm sg` prints every
match, and `pnpm lint` ratchets them per rule with `scripts/lint-ratchet.ts`:
a rule without a cap in `scripts/lint-ratchet.json` is an error. The lucide
re-export in plugin-ui `icons.ts` and the dshx `client/index.d.ts` are the
exempt public re-export boundaries.
