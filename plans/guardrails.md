# Guardrails adoption

Adopt the lint, pinning, knip, tsconfig and state guardrails that emisoup,
pandwind and emilint already enforce. Audited 2026-10-14 against `main`.

## Baseline

| Measure | At audit |
|---|---|
| Version ranges | 193 `^`/`~` outside peer dependencies (157 `^`, 36 `~`) in 39 of 40 manifests; no `save-exact`. Most repeated: `vitest ^4.1.10` ×30, `@types/node ^22.19.0` ×29, `@types/react ~18.3.31` ×27, `react ^18.3.1` ×25, `zod ^4.4.3` ×23; the root has `zod ^4.6.5` (drift) |
| `link:` | 59: 31 `@dshfiles/dshx` in plugins, 28 bundle links in `profiles/web` (documented exception) |
| Export bags | 114 source files reach emisoup's `no-domain-export-bag` threshold (≥3 lowercase callable exports); shadcn `ui/` excluded |
| Plugin client hooks | 95 `useEffect`/`useLayoutEffect`, 232 `useState`; xstate used in 2 files |
| Components >300 lines | 24 of 108 `.tsx`; largest: thread-sidebar `client.tsx`, jujutsu `client.tsx`, `sidebar-shell.tsx` |
| Oxlint | 2130 warnings, 0 errors: nothing enforced |
| emilint ast-grep | 409: `JSON.parse` 176, `export … from` 173, nested ternary 53, `export *` 4, raw `response.json()` cast 1 |
| knip | only `tooling/dshx`; plugins, root and desktop unchecked |
| tsconfig | 33 standalone plugin configs (strict + `noUncheckedIndexedAccess`); none carry dshx's `verbatimModuleSyntax`/`noImplicitOverride`/`isolatedModules` |

## Decisions

- **Lint.** `tooling/antislop/index.mjs` is emilint `2bb430dd`. Low-count
  antislop rules are fixed and promoted to `error`; the rest stay warnings
  behind a per-rule ratchet, so a new plugin cannot add findings and each
  refactor lowers the caps. emilint's ast-grep rules are vendored at the same
  revision beside the bundle.
- **Pinning.** `save-exact=true`, repeated versions in `catalog:`, each range
  rewritten to its locked version so resolution does not change; peer ranges
  stay ranges. Enforced in `plugins/scripts/check-workspace-contract.ts`. Do it
  after the single root: both rewrite the same 33 manifests.
- **knip.** One root config copying dshx's `include` list, per-plugin entries
  (`src/host.ts`, `src/client.tsx`, bundle entries), `--production`.
- **tsconfig.** Plugins extend one client base carrying dshx's flag set.
- **No lefthook.** Git hooks never fire on jj commits; use `jj fix` with oxfmt
  plus `pnpm check`.
- **Export bags → namespace classes.** emilint has no rule; upstream emisoup's
  `emi/no-domain-export-bag` as `antislop/no-export-bag {minExports,
  excludePaths}` (Oxlint, since it counts exports per file), excluding
  `components/ui/**` and the dshx public `index.ts`. Hotspots:
  `dshx/communication/types.ts`, thread-sidebar `organization.ts`, ai-accounts
  `api.ts`, `thread-view-preferences.ts`.
- **XState.** Follow emisoup: `*-machine.ts` uses `setup({types, actors})` with
  throwing placeholder actors, a thin `use-*.ts` hook calls
  `.provide({actors})`, components only use `useActorRef`/`useSelector`/`send`;
  tags replace boolean `useState`; each operation carries an identity so stale
  completions are dropped, tested in node with `createActor` and deferred
  promises. Ownership follows the `actor-state-ownership` skill. Order:
  jujutsu, thread-sidebar, ai-accounts; verify each with the plugin's e2e
  journey.
- **Hono fakes.** Replace the `node:http` fakes (`fake-command-code.ts`, the hub
  fake in `plugin-marketplace.steps.ts`) with pandwind's split: a pure
  `create…App()` Hono app served by `@hono/node-server` on port 0, `streamSSE`
  for streaming, and chat dispatch kept a pure function. Pins: `hono 4.13.5`,
  `@hono/node-server 2.1.1` (dshx dev dependencies). Leave the stdio
  `fake-mcp-server.mjs`.
- **Single root.** The stale `pnpm-root` revisions are not rebased. Redo from
  `main` with `.`, `plugins/@dshfiles/*` and `tooling/dshx/packages/*`, desktop
  separate at first, `profiles/web` kept separate. Reuse the root
  `pnpm-workspace.yaml` settings, the `@playwright/test 1.56.1`
  `packageExtensions` fix for `@dshfiles/dshx`, and the resolution audit from
  `docs/dependency-topology.md`.

## Sequence

Steps 1–5 do not touch the plugins other workspaces are changing. Steps 6–12
wait for the `memory` and `usage` plugins to land.

- [x] 1. `chore(lint)`: react plugin, per-rule warning ratchet, unused-directive report.
      `pnpm lint` runs `scripts/lint-ratchet.ts`: any error, or any rule above
      its cap in `scripts/lint-ratchet.json`, fails; an unknown rule has cap 0.
      React uses emisoup's off-list (which also turns off `refs` and
      `set-state-in-effect`); `exhaustive-deps` and `purity` are warnings.
      Caps at landing (2166 warnings): conditional-empty-object-spread 483,
      safety-comment-for-type-assertion 419, runtime-typeof 357,
      unsafe-dictionary-type 255, unknown-parameters 211, known-value-widening
      159, unknown-returns 120, chained-type-assertions 42, passthrough-variable
      38, reflect-get 28, exhaustive-deps 26, reflect-apply 10, purity 10,
      broad-object-parameters 8.
- [ ] 2. `refactor`: fix the 126 low-count antislop sites (broad-object 8,
      reflect-apply 10, reflect-get 28, passthrough 38, chained assertions 42),
      one revision per rule, then promote each to `error`.
- [x] 3. `chore(lint)`: vendor emilint ast-grep rules, `sgconfig.yml`, `pnpm sg`.
      Rules in `tooling/antislop/ast-grep/rules/`, `@ast-grep/cli 0.45.3`,
      ratcheted by `pnpm lint`. Caps at landing: `JSON.parse` 177 (+1 tsx),
      `export … from` 172, nested ternary 27 + 26 tsx, `export *` 3, raw
      `response.json()` cast 1; every other rule is an error.
      Fixed outside in-progress areas: the raw `response.json()` cast (rule now
      an error) and 38 nested ternaries.

## Deferred sites

Files other workspaces are changing; fix them, lower the cap, and promote the
rule to `error` once those land.

- **Nested ternary** (caps 12 + 3 tsx):
  - `plugins/@dshfiles/optmem/src/host.ts` (7: lines 223–229, 412–416)
  - `tooling/dshx/packages/dshx/src/compiler/host/build.ts` (5: lines 80–88)
  - `plugins/@dshfiles/editor/src/editor-panel.tsx:333`, `file-tree.tsx:52`
  - `plugins/@dshfiles/jj-integration/src/panel.tsx:21`
- **`export *`**: `plugins/@dshfiles/optmem-core/src/index.ts`
  (`export type * from './types.ts'`; optmem workspaces are changing
  `types.ts`).
- [ ] 4. ~~`refactor(plugin-ui)`: named `machine` exports~~ (done; `export *` cap 1). `docs`: shared skills in
      `AGENTS.md`, link `actor-state-ownership` from `plugin-state`.
- [ ] 5. `chore(knip)`: `plugins/knip.jsonc`, report-only.
- [ ] 6. `chore(deps)`: single root, redone from `main`.
- [ ] 7. `chore(deps)`: `save-exact`, catalog, pins taken from the lockfile, contract check.
- [ ] 8. `chore(knip)`: root config, added to `check`.
- [ ] 9. `chore(tsconfig)`: shared plugin base.
- [ ] 10. `test(e2e)`: Hono fake Command Code, then the hub fake.
- [ ] 11. emilint `feat(antislop)`: `no-export-bag`; re-vendor as warn.
- [ ] 12. `refactor(<plugin>)`: XState and namespace classes per plugin
      (jujutsu → thread-sidebar → ai-accounts → rest). Each slice lowers the ratchet.
