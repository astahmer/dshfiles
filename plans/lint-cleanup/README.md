# Lint cleanup campaign

## Why

`chore(lint): fix the error findings and adopt the measured ratchet baseline`
raised every warning cap to its measured count. The gate went green while ~2900
findings stayed accepted as baseline. This campaign removes them with real code
fixes and ratchets each cap down as a rule empties. No rule is disabled and no
path is excluded.

## Where it stands

### Resume here (2026-11-11, after upstream #250 and #251)

The clean `main` snapshot `1ac2f08f` was red again. After the current chunk,
Oxlint is 1,036 → 1,034, ast-grep is 155 → 151, Effect anti-slop remains
36 (baseline 33), and formatting drift is 10 → 0. No caps were raised or
lowered in this chunk: the rules still above cap need real fixes first.

| Rule | Before | After | Cap |
| --- | ---: | ---: | ---: |
| `require-safety-comment-for-type-assertion` | 305 | 305 | 297 |
| `no-unknown-parameters` | 237 | 237 | 226 |
| `no-unsafe-dictionary-type` | 179 | 179 | 169 |
| `no-unknown-returns` | 118 | 118 | 117 |
| `no-known-value-widening` | 101 | 101 | 95 |
| `ui-guidance(no-native-title)` | 64 | 64 | 64 |
| `no-runtime-typeof` | 26 | 26 | 26 |
| `no-conditional-empty-object-spread` | 2 | 0 | 0 |
| Oxlint errors | 4 | 4 | 0 |
| `no-deeply-nested-ternary` | 3 | 0 | 0 |
| `no-direct-json-parse` | 151 | 150 | 147 |
| `no-direct-json-parse-tsx` | 1 | 1 | 1 |

The two conditional spreads now preserve omission and metadata semantics;
GitLab merge-state precedence is explicit, and one MCP test uses the shared JSON
boundary. The 10 drifted committed files are formatted. Remaining errors are
`pull-requests`' forge export bag and passthrough alias, and the idle scheduler
and raw error in `context-compaction`. The scheduler must preserve 60-second
fixed ticks, overlap protection, abort/disposal, and process-liveness behavior;
it needs lifecycle tests rather than a mechanical lint rewrite. Remaining new
MCP transport findings also need typed boundaries, not casts or suppressions.
Re-measure on the then-current clean `main`, fix the over-cap rules and three
Effect findings, and lower caps only after the gates pass.

### Previous milestone

Measured on a `git archive` of `main` (`be839049`, 2026-11-11) so no other
agent's uncommitted edits counted. The gate was **red** there: 1 error-level
finding, 4 rules over cap, one Effect finding over baseline, and 6 files with
format drift. Each item is fixed and every cap now equals its measured count:

| Checker            | Start (campaign) | Red main | Now |
| ------------------ | ---------------- | -------- | --- |
| oxlint             | 2433             | 1019     | 986 |
| ast-grep           | 461              | 150      | 148 |
| effect-antislop    | n/a              | 34       | 33  |
| `fmt:check` drifts | n/a              | 6        | 0   |

Per rule (oxlint). Cap equals count, so a new finding fails the gate:

| Rule                                        | Red main | Now | Cap |
| ------------------------------------------- | -------- | --- | --- |
| `require-safety-comment-for-type-assertion` | 297      | 297 | 297 |
| `no-unknown-parameters`                     | 240      | 227 | 227 |
| `no-unsafe-dictionary-type`                 | 176      | 169 | 169 |
| `no-unknown-returns`                        | 116      | 116 | 116 |
| `no-known-value-widening`                   | 92       | 87  | 87  |
| `ui-guidance(no-native-title)`              | 64       | 64  | 64  |
| `no-runtime-typeof`                         | 32       | 26  | 26  |
| `no-conditional-empty-object-spread`        | 1        | 0   | 0   |
| `no-export-bag` (error)                     | 1        | 0   | 0   |

ast-grep: `no-direct-json-parse` 147 (cap 147), `no-direct-json-parse-tsx` 3 → 1
(cap 1); every other rule is at 0. `check:zod-imports` reports 11 recorded
bridges and no unlisted import, and `pnpm lint` is green.

2026-11-11 fixes, nearest zero first:

- `no-export-bag`: `dshx/src/settings/client.ts` groups its cohesive Settings
  helpers under `SettingsClient` (static `create`/`provide`), leaving
  `observeSettings` as the one exported function; it returns the named
  `SettingsObservation<ClientValue>`.
- `no-conditional-empty-object-spread`: `session-undo` builds the checkpoint
  summary and adds `revision` only when present, with a test asserting the
  property is absent.
- `no-direct-json-parse-tsx`: `plugin-ui` asserts the serialized localStorage
  value instead of parsing it; `thread-sidebar` decodes its client revision
  snapshot through `@dshfiles/dshx/json` with `Schema.Array(Schema.Tuple(...))`.
- `effect-migration(no-cause-dropping-catch)`: `conversation-cleanup`'s
  `JsonlPurgeRefused` carries `cause: Schema.optional(Schema.Defect())` while its
  recovery message stays bounded.
- `no-runtime-typeof` / `no-unsafe-dictionary-type` / `no-unknown-parameters`
  (jj-integration): the JSON Schema boundary uses Effect's `JsonSchema` and
  `Schema.Json` types and decodes the merged document once.
- `no-unknown-parameters` (test decode helpers): helpers that run a schema decode
  are named as boundaries (`decodeWith`, `checkDecodes`, `decodeInput`,
  `checkConfig`, `checkDraft`, `resolveClosedDocument`, `toWire`).
- `no-known-value-widening`: `loopback-access` types its closed address-label
  dictionary with `satisfies`; `optmem-core` names its bounded text result.
- Format drift: the six committed files are formatted.
- Not a lint finding, but `pnpm typecheck` was red on the same `main`:
  `tests/tracing.spec.ts` narrowed the `unknown` in-process delivery contract.
  The fixture now decodes the delivered batch with its export schema.

## Remaining work, in order

1. `require-safety-comment-for-type-assertion` (297) and
   `no-unknown-parameters` (227) are the two biggest piles; take them one
   package at a time.
2. `no-unsafe-dictionary-type` (169), `no-unknown-returns` (116) and
   `no-known-value-widening` (87): replace open dictionaries with named owner
   contracts and keep inference.
3. `ui-guidance(no-native-title)` (64): hover help becomes the plugin-ui
   `Tooltip`; a prop that labels a section, card or dialog is renamed
   `heading`/`label`.
4. `no-runtime-typeof` (26): branch on domain values; `typeof` stays only inside
   a decoder.
5. `no-direct-json-parse` (147): about 76 sites remain in
   `tooling/dshx/packages/dshx/tests`; dshx `src` is done (2026-11-04).
6. `pulls-review/src/client.tsx` still parses the legacy reviewed-marks
   localStorage value directly (the last non-native TSX `JSON.parse`). It
   deletes the key before parsing, so moving it to a decoder must preserve the
   malformed-value behaviour and be covered by migration tests.
7. Re-measure on a clean archive and lower every cap again when a rule empties.

Measure a clean tree: in a shared workspace, other agents' uncommitted edits
change the counts. Running
`git --git-dir=<repo>/.git archive <commit> | tar -x -C <dir>`, symlinking
`node_modules` and running the ratchet there counts exactly what is committed.
`check:zod-imports` now skips the tool's own build caches
(`tooling/dshx/packages/dshx/client-runtime`, `runtime-store`); before that fix
the gate failed on any tree that had run a build.

## Decisions (do not re-litigate)

- **Public package entries are boundaries.** A file that is its package's
  `exports`/`main` target is a declared public boundary and joins
  `astGrepBoundaries` in `scripts/lint-ratchet.ts`. Internal directory barrels
  are not: importers move to the defining modules and the barrel dies.
- **One JSON boundary per runtime.** `scripts/json.ts` for repository scripts,
  `@dshfiles/dshx/json` for package and plugin code. Call sites pass the owning
  schema; nobody calls `JSON.parse` directly. A browser-reachable dshx module
  must not import zod — keep the decode Host-side or use a local predicate.
- **Transport payloads are `JsonValue`, not `unknown`.** Internal values get a
  named interface.
- **`title=` is hover help only.** Hover help becomes the plugin-ui `Tooltip`;
  a prop that labels a section, card or dialog is renamed `heading`/`label`
  (`ProjectFolderPicker`, `CommandDialog`, `ToolCard`, `Breakdown`).
- **`typeof` inside a decoder is fine.** `allowInTypeGuards`,
  `allowWhenStaticallyTyped` and `allowInBoundaryFunctions` are enabled; a
  `typeof` in the middle of domain code is not. The same naming contract covers
  `no-unknown-parameters`: a helper that decodes with a schema is a boundary and
  is named as one (`decode*`, `parse*`, `check*`, `read*`, `resolve*`, `to*`).
- **Cohesive module helpers group under one namespace class.** Three or more
  lowercase callable exports in one module is an export bag; dshx `src` keeps
  boundary and hook exports explicit instead.

## Hazards (read before resuming)

- **Another workspace can reconcile this repo's working copy.** During the
  campaign another thread's `jj` operations force-checked-out this workspace and
  silently reverted in-flight edits. Never let a subagent run `jj`, and commit
  early.
- `jj status` snapshots the working copy; a snapshot taken while an external
  process is mid-checkout can resurrect stale content.
- Rebuild `tooling/dshx/packages/dshx/dist` after touching dshx sources, before
  any plugin build or typecheck that resolves `@dshfiles/dshx/*`.
- Screens are due a refresh after the Tooltip conversions: jj-integration Thread
  Workspaces panel / destination bar / thread-control popover / notices /
  log-download row; traces panel, span detail, logs, metrics; agent-communication activity and compose rows;
  agent-toolkit tables; agents reference preview; ai-accounts accounts page,
  usage strip/popover, models page, settings, edge widget, API-key picker;
  memory header, notes tab, analytics tab, reference preview. `pnpm screenshots`
  captures them from a scratch DSH; `node --run check:screenshots` only checks
  presence.
