# Lint cleanup campaign

Resume here: rule batches run in the order below. After each batch, update its
row, lower the rule's cap in `scripts/lint-ratchet.json` to the measured count,
and land one described revision.

## Why

`jj:69e796bf` ("chore(lint): fix the error findings and adopt the measured
ratchet baseline") raised every warning cap to its measured count. The gate is
green, but 2894 findings remain accepted as baseline (oxlint 2433, ast-grep
461). This campaign removes them with real code fixes and ratchets each cap down
as its rule empties. Caps only ever move down; no rule is disabled and no path
is excluded.

## Measurement

```sh
pnpm lint                                    # per-rule count vs cap
pnpm exec oxlint tooling/dshx/packages plugins scripts apps/desktop/src \
  --config .oxlintrc.json --format json > /tmp/oxlint.json
pnpm sg                                      # every ast-grep match
```

## Progress

Campaign start: 2894 accepted findings (oxlint 2433, ast-grep 461). Now 1987
(oxlint 1736, ast-grep 251).

| Rule                                                | Start | Now | State       |
| --------------------------------------------------- | ----- | --- | ----------- |
| ast-grep(no-deeply-nested-ternary)                  | 7     | 0   | done        |
| ast-grep(no-deeply-nested-ternary-tsx)              | 12    | 0   | done        |
| ast-grep(no-wildcard-export)                        | 1     | 0   | done        |
| ast-grep(no-export-from)                            | 179   | 0   | done        |
| ast-grep(no-direct-json-parse)                      | 258   | 247 | in progress |
| ast-grep(no-direct-json-parse-tsx)                  | 4     | 4   | todo        |
| antislop(no-conditional-empty-object-spread)        | 539   | 0   | done        |
| antislop(require-safety-comment-for-type-assertion) | 387   | 385 | todo        |
| antislop(no-runtime-typeof)                         | 386   | 381 | next        |
| ui-guidance(no-native-title)                        | 309   | 309 | todo        |
| antislop(no-unsafe-dictionary-type)                 | 237   | 218 | todo        |
| antislop(no-unknown-parameters)                     | 224   | 224 | todo        |
| antislop(no-known-value-widening)                   | 183   | 96  | in progress |
| antislop(no-unknown-returns)                        | 136   | 123 | todo        |
| react(purity)                                       | 19    | 0   | done        |
| react-hooks(exhaustive-deps)                        | 13    | 0   | done        |

## Landed batches

1. `chore(lint): decode tooling JSON through one validated boundary` — scripts
   + `plugins/scripts`, one `decodeJson`/`decodeJsonSafe` in `scripts/json.ts`;
   package entry points declared as ast-grep boundaries.
2. `chore(dshx): keep type evidence instead of widening it` — 90
   known-value-widening findings, 11 internal barrels deleted, importers on
   defining modules.
3. `chore(plugins): clear the owned plugins' baseline lint findings` — nested
   ternaries, render-time clocks and hook dependencies, conditional spreads,
   and barrel importers across the owned plugins.
4. Caps ratcheted to the measured counts (below).

## Next

1. **no-runtime-typeof** — decision taken: enable the rule's own
   `allowInTypeGuards`, `allowWhenStaticallyTyped` and
   `allowInBoundaryFunctions` options (341 of 386 checks sit in the decoders the
   rule classifies as boundaries), then fix the ~30 that remain by decoding at
   the call site.
2. **no-direct-json-parse** — same `decodeJson` boundary for dshx (one module,
   imported by src and tests) and for the plugins that parse stored JSON.
3. **no-unsafe-dictionary-type / no-unknown-parameters / no-unknown-returns** —
   `JsonValue` (already schema-backed in dshx) for transport payloads, named
   interfaces for internal values; add `JsonValue`/`JsonObject` to the shared
   boundary rather than repeating `Record<string, unknown>`.
4. **require-safety-comment-for-type-assertion** — remove assertions a schema or
   guard already establishes; add a `SAFETY:` comment only where the invariant
   is real and not expressible in the type.
5. **no-native-title** — Tooltip for hover help, `heading`/`label` rename for
   section labels, with a screenshot refresh per the plugin-UI contract.

## Decisions

These are campaign-wide, so later batches do not re-litigate them:

- **Public package entries are boundaries.** A file that is the target of its
  package's `exports`/`main` (a barrel whose only job is to publish the package
  surface) is a declared public boundary. It joins `astGrepBoundaries` in
  `scripts/lint-ratchet.ts` with the package it serves. Internal directory
  barrels that merely aggregate a folder are not boundaries: their importers
  move to the defining modules and the barrel is deleted.
- **One JSON boundary per runtime.** JSON text becomes a value in one place per
  runtime (Node and browser), through that module's schema-validated decoder.
  That module is the documented boundary for `no-direct-json-parse`; call sites
  pass a schema and stop calling `JSON.parse` themselves.
- **Dynamic transport payloads are `JsonValue`, not `unknown`.** `JsonValue`
  already ships with its schema in dshx `platform/client.ts`; plugins that take
  arbitrary payloads use a schema-derived value type of their own. Internal
  values get a named interface, never `Record<string, unknown>`.
- **`title=` replacement is per element.** Intrinsic/`Button`/`span` hover help
  becomes plugin-ui `Tooltip`; a component prop that merely labels a section or
  card (e.g. `Breakdown title=`) is renamed to `heading`/`label` so it stops
  looking like hover help.

## Per-rule approach

- **no-deeply-nested-ternary** — replace 3+ level cascades with early returns
  in a named helper, or a `Record`/switch. Two-level ternaries stay.
- **react(purity)** — `Date.now()`/`new Date()` in render: derive the instant
  once in state/effect, or take it from props; never call it per render.
- **react-hooks(exhaustive-deps)** — depend on the stable member the effect
  calls (`mutation.reset`), or move the unstable expression into `useCallback`
  / `useMemo` inputs; never silence with a disable.
- **no-export-from / no-wildcard-export** — implementation modules stop
  forwarding: consumers import from the defining module. A file that is the
  export-map target of a package is a public boundary; declare it in
  `astGrepBoundaries` in `scripts/lint-ratchet.ts` with the package it serves
  rather than leaving a silent cap.
- **no-direct-json-parse** — decode through the owning schema (`zod` / dshx
  schema) at the boundary; test fixtures may reuse the production schema or a
  local fixture schema in the test file.
- **no-conditional-empty-object-spread** — build the object, then add optional
  properties in a statement, or construct the narrowed object in one place.
- **require-safety-comment-for-type-assertion** — remove the assertion when a
  schema/guard already produces the type; otherwise add a `SAFETY:` comment
  saying why the assertion holds.
- **no-runtime-typeof** — decode external values at their I/O boundary; inside
  a domain function branch on the parsed value. Enable
  `allowInTypeGuards`/`allowWhenStaticallyTyped` only where the rule's own
  options describe the existing guard.
- **no-native-title** — replace `title=` with the plugin-ui `Tooltip` (or the
  component's existing accessible label), never a raw native tooltip.
- **no-unsafe-dictionary-type** — replace `Record<string, unknown>`/`any`
  values with an owner contract or a schema-derived value type.
- **no-unknown-parameters / no-unknown-returns / no-known-value-widening** —
  parse at the boundary and name the result; drop annotations that discard
  evidence; use `satisfies` when only checking shape.
- **react-hooks(exhaustive-deps)** — see above.
