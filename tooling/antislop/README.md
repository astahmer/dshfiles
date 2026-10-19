# Antislop rules

Vendored generated Oxlint plugin from the owned `emilint` repository, revision
`cb91a4faeacafaba333600e5af42d333cd5e02b8` (local; unpublished, with upstream
publication pending explicit human approval). Update from its source and
rebuild there; do not edit this bundle. Existing findings remain warnings during
the quality pass; correctness checks remain errors.

`ast-grep/rules/` holds emilint's ast-grep rules from the same revision, also
unedited; `sgconfig.yml` at the root points at them. `pnpm sg` prints every
match, and `pnpm lint` ratchets them per rule with `scripts/lint-ratchet.ts`:
a rule without a cap in `scripts/lint-ratchet.json` is an error. The lucide
re-export in plugin-ui `icons.ts` and the dshx `client/index.d.ts` are the
exempt public re-export boundaries.

`repo-rules/` holds rules this repository owns, added to the same `sgconfig.yml`
rule directories and ratcheted the same way. They are not part of the vendored
revision and are candidates for upstreaming to emilint.

- **no-identity-hook-selector** — avoid passing a hook selector that returns its
  own argument (`useSessions(state => state)`); prefer selecting the fields the
  component renders (`state => state.byId`) or passing an explicit equality
  function, because an identity selector hands the whole snapshot to every
  consumer and re-renders it on every store update, however little changed. The
  DSH session controller rebuilds every summary per list projection, so this is
  the difference between one row re-rendering and all of them (see
  `plugins/@dshfiles/thread-sidebar/README.md`). A narrow selector or a two
  argument call with an equality function is accepted.
