# Lint cleanup campaign

## Why

`chore(lint): fix the error findings and adopt the measured ratchet baseline`
raised every warning cap to its measured count. The gate went green while ~2900
findings stayed accepted as baseline. This campaign removes them with real code
fixes and ratchets each cap down as a rule empties. No rule is disabled and no
path is excluded.

## Where it stands

`pnpm lint` is green. Measured with `node scripts/lint-ratchet.ts oxlint` and
`node scripts/lint-ratchet.ts ast-grep` (2026-10-29):

| Checker  | Start | Now |
| -------- | ----- | --- |
| oxlint   | 2433  | 958 |
| ast-grep | 461   | 183 |

Per rule (oxlint, finding count / cap): `no-native-title` 89 / 309,
`require-safety-comment-for-type-assertion` 330 / 385, `no-unknown-parameters`
158 / 224, `no-unsafe-dictionary-type` 162 / 218, `no-unknown-returns` 109 / 123,
`no-known-value-widening` 87 / 96, `no-runtime-typeof` 23 / 381.

ast-grep: `no-direct-json-parse` 181 / 247, `no-direct-json-parse-tsx` 2 / 4.

## Remaining work, in order

1. **dshx** — `no-direct-json-parse` in `src/project/*`,
   `src/communication/bridge.ts`, `src/platform/*` and the dshx tests, then the
   antislop tail.
2. **ai-accounts** — `api-key-setup-dialog.tsx` plus the antislop tail.
3. **multi-host, thread-sidebar, traces, annotations** — mostly
   `no-direct-json-parse` and `unknown` parameters.
4. **The long tail** of the per-rule counts above.
5. **Ratchet the caps** to the measured counts once the tail is done, then
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
  log-download row; traces panel, span detail, logs, metrics; plugin-marketplace
  cards + toolbar; agent-communication activity and compose rows;
  agent-toolkit tables; agents reference preview; ai-accounts accounts page,
  usage strip/popover, models page, settings, edge widget, API-key picker;
  memory header, notes tab, analytics tab, reference preview. `pnpm screenshots`
  captures them from a scratch DSH; `node --run check:screenshots` only checks
  presence.
