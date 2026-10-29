# Lint cleanup campaign

Resume here: the assembled state lives on `local-spine` as `jj:d2fc3d02`
(parent `jj:rwrpvyos`, the merge that brought the campaign into local-spine).
`pnpm --dir plugins run typecheck` is green (145/145 tasks) on that commit.
The lint gate is **not** green yet — see "Blocking the gate".

## Why

`chore(lint): fix the error findings and adopt the measured ratchet baseline`
raised every warning cap to its measured count. The gate went green while ~2900
findings stayed accepted as baseline. This campaign removes them with real code
fixes and ratchets each cap down as a rule empties. No rule is disabled and no
path is excluded.

## Where it stands

Measured on `jj:d2fc3d02`:

| Checker  | Start | Now |
| -------- | ----- | --- |
| oxlint   | 2433  | 969 |
| ast-grep | 461   | 166 |

Per rule (oxlint): `no-native-title` 309 → 92, `require-safety-comment` 387 →
323, `no-unknown-parameters` 224 → 167, `no-unsafe-dictionary-type` 237 → 155,
`no-unknown-returns` 136 → 106, `no-known-value-widening` 183 → 72,
`no-runtime-typeof` 386 → 20, `no-conditional-empty-object-spread` 539 → 24.

Already at zero: nested ternaries, `no-export-from`, `no-wildcard-export`,
`react(purity)`, `no-passthrough-variable`, `no-chained-type-assertions`.

ast-grep: `no-direct-json-parse` 258 → 164 (162 ts + 2 tsx),
`no-deeply-nested-ternary-tsx` 2 left.

Remainder by package: dshx 76, ai-accounts 26, multi-host 11, thread-sidebar 10,
traces 10, annotations 8, jj-integration 5, create-dshx 3, backlog 3, plugin-ui
2, project-checks 2, plugin-marketplace 2.

## Blocking the gate

`pnpm lint` exits 1 on ten findings, all in the error-level slot:

1. `plugins/@dshfiles/annotations/src/{descriptor,redact,http,chrome-cdp,chrome-launch,source,sourcemap}.ts`
   — `antislop/no-export-bag` (cap 0). The annotations repair restored the
   namespace-bag design from the package's own build maps, but these seven files
   each export a helper set the rule wants grouped under one namespace class.
   Finish the bag refactor (call sites are inside the package plus
   `ui/picker-overlay.tsx`) or declare them boundaries.
2. `plugins/@dshfiles/annotations/src/descriptor.ts:9` — `no-reflect-get`;
   replace `Reflect.get` with typed property access.
3. `plugins/@dshfiles/thread-sidebar/src/subagent-provenance/SubagentHeaderLineage.tsx:13`
   — unused `TooltipProvider` import left over from the `NativeTooltip` fix.
4. `plugins/@dshfiles/annotations/src/ui/annotations-action.tsx:58` —
   `react-hooks/exhaustive-deps` (cap 0): the effect is missing `list`.

All four are mechanical.

## Landed

1. `chore(lint): decode tooling JSON through one validated boundary` — one
   `decodeJson`/`decodeJsonSafe` in `scripts/json.ts`; package export-map entry
   points declared as ast-grep boundaries.
2. `feat(dshx): expose one validated JSON decode boundary` — `@dshfiles/dshx/json`
   publishes `decodeJson`, `decodeJsonSafe`, `JsonValue`, `JsonObject`,
   `jsonValueSchema`, `jsonObjectSchema`. The Host build inlines it through a
   virtual module (`DSHX_JSON_PUBLIC`), which is what stops `DSHX1302` on every
   Host bundle that decodes JSON.
3. `chore(lint): use the typeof rule's boundary options` — 386 → 28, then the
   last 28 decoded at their call sites (0).
4. `fix(plugins): keep the vendored host entries visible to knip`.
5. `chore(lint): clear the ratcheted findings across the baseline` and
   `chore(lint): finish the baseline-warnings sweep on local-spine` — the
   verified per-package work (dshx, annotations, ai-accounts, memory, jujutsu,
   thread-sidebar, traces, marketplace, agent-*, backlog, plugin-ui, ~20 small
   plugins) plus the `ProjectFolderPicker`/`CommandDialog` `title` → `heading`
   rename.

## Remaining work, in order

1. **The ten error-level findings above** — the gate cannot pass without them.
2. **dshx (76 ast-grep + oxlint tail)** — `no-direct-json-parse` in
   `src/project/*`, `src/communication/bridge.ts`, `src/platform/*` and the dshx
   tests, then the antislop tail. A 32-file overlay that reached 0 for most of
   them was kept in `/tmp/bak-dshx` (may not survive a reboot; regenerate from
   the tree if gone).
3. **ai-accounts (26)** — the 21 tooltip files are in; what is left is
   `api-key-setup-dialog.tsx` plus the antislop tail.
4. **multi-host (11), thread-sidebar (10), traces (10), annotations (8)** —
   mostly `no-direct-json-parse` and `unknown` parameters.
5. **The long tail** — `no-native-title` 92, `require-safety-comment` 323,
   `no-unknown-parameters` 167, `no-unsafe-dictionary-type` 155,
   `no-unknown-returns` 106, `no-known-value-widening` 72,
   `no-conditional-empty-object-spread` 24, `no-runtime-typeof` 20.
6. **Ratchet the caps** to the measured counts once the tail is done, then
   re-run `pnpm lint`.

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
  `typeof` in the middle of domain code is not.

## Hazards (read before resuming)

- **Another workspace reconciles this repo's working copy.** During this
  campaign `thread-1a2080` ran `jj` operations that repeatedly force-checked-out
  this workspace, silently reverting in-flight edits (twice destroying ~40 files
  each time). What worked: never let a subagent run `jj`; back every finished
  file up under `/tmp`; commit early; treat the `/tmp/bak-*` overlays as the
  source of truth when the tree disagrees.
- `jj status` snapshots the working copy; a snapshot taken while an external
  process is mid-checkout can resurrect stale content.
- Rebuild `tooling/dshx/packages/dshx/dist` after touching dshx sources, before
  any plugin build or typecheck that resolves `@dshfiles/dshx/*`.
- Screens are due a refresh after the Tooltip conversions: jj-integration Thread
  Workspaces panel / destination bar / thread-control popover / notices /
  log-download row; traces panel, span detail, logs, metrics; plugin-marketplace
  cards + toolbar; agent-communication activity and compose rows;
  agent-toolkit tables; agents reference preview; ai-accounts accounts page,
  usage strip/popover, models page, settings, edge widget, API-key picker;
  memory header, notes tab, analytics tab, reference preview. `pnpm screenshots`
  captures them from a scratch DSH; `node --run check:screenshots` only checks
  presence.
