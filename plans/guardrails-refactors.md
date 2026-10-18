# Guardrails, steps 10–12: Hono fakes, export bags, XState

The last three steps of [the guardrails plan](guardrails.md). Steps 1–9 are done: lint ratchet, ast-grep rules,
exact pins and catalog, root knip, shared tsconfig. Each step below lands as small revisions that keep `pnpm check`
(with its cached `@smoke` journeys) green, plus `pnpm check:e2e <plugin>` for every plugin touched.

## Step 10 — Hono for the e2e fakes

**Why:** the test fakes route by hand (`if (url === …)`), which hides the API surface they emulate and makes new
routes error-prone. pandwind's pattern: a pure `create…App()` Hono app plus a tiny `serve` wrapper.

**Today:**

| Fake                                                                                   | Kind                             | Routing                                               |
| -------------------------------------------------------------------------------------- | -------------------------------- | ----------------------------------------------------- |
| `tooling/dshx/packages/dshx/src/scratch/fake-command-code.ts`                          | HTTP (model provider)            | 5 hand-written branches plus body-based chat dispatch |
| `tooling/dshx/e2e/support/fake-oauth-mcp.ts`                                           | HTTP (MCP server + OAuth server) | 7 hand-written branches                               |
| the hub fake in `tooling/dshx/e2e/support/plugin-journeys/plugin-marketplace.steps.ts` | HTTP (Framework Hub)             | 6 pathname branches                                   |
| `fake-mcp-server.mjs`, `fake-secret-cli.mjs`                                           | stdio / CLI                      | out of scope                                          |

**Slices:**

- [x] 10a. `chore(deps)`: pin `hono` and `@hono/node-server` in the pnpm catalog as dshx dev dependencies; Knip is clean.
- [x] 10b. `test(e2e)`: `createFakeCommandCodeApp(state)` — explicit routes, SSE through `streamSSE`, and port 0.
      Chat dispatch remains testable through `app.request()` without a socket.
- [x] 10c. `test(e2e)`: the OAuth MCP fake is a Hono app (discovery, registration, PKCE, sign-in/out routes).
- [x] 10d. `test(e2e)`: the hub fake lives in `support/fake-hub.ts` as a Hono app.
- [x] 10e. `docs(e2e)`: the fakes pattern is documented in `docs/e2e-testing.md`.

**Done when:** no fake routes on `url`/`pathname` comparisons; each fake has unit tests through `app.request()`;
`pnpm check:e2e` for diff-viewed, tool-meta, memory, mcp-servers, plugin-marketplace and `dshx dev` seeds that
use the provider fake are green.

**Verified (2026-10-18):** `dev-scratch.spec.ts` (15/15) and `fake-command-code.spec.ts` (2/2) pass; dshx
typecheck/build and `check:diff` pass. Provider-backed `dshx dev open` paths pass for main-tabs, activity-timeline,
tool-meta, Jujutsu chat references and AI Accounts credential recovery. `check:e2e` passes for diff-viewed (3),
tool-meta (2), memory (3), mcp-servers (5), plugin-marketplace (4), ai-accounts (14) and jujutsu (11). Scratch
doctor passed with all seven requested bundles loaded and no host-log errors; shots still record HTTP 404 probes
for `/api/dshx-2113d713/state`, `/api/dshx-e1cc781b/destination` and
`/api/dshx-e1cc781b/classifyWorkspaces`, but zero page errors. Feature coverage still reports the same 10
catalog issues in jj-integration, pulls-review and thread-sidebar; changed catalogs add none.

## Step 11 — `no-export-bag` lint rule (in emilint)

**Why:** the repo rule is "one namespace class with static members, not a bag of peer exports". Today it is enforced
by review only. emisoup already has the rule (`emi/no-domain-export-bag`, `~/dev/emisoup/scripts/oxlint/emi-plugin.mjs`):
it flags three or more lowercase callable exports in a non-test, non-tsx file and exempts hooks and PascalCase names.
ast-grep can't count matches per file, so it must be an Oxlint JS rule.

**Slices:**

- [ ] 11a. emilint `feat(antislop)`: `antislop/no-export-bag` with options `{ minExports, excludePaths }`, ported
      from emisoup with tests in emilint's `tests/`; release it the way emilint ships rules. Push emilint when the
      user approves.
- [x] 11b. dshfiles `chore(lint)`: re-vendor `tooling/antislop` at that emilint revision; enable the rule as a
      ratcheted warning with excludes for `components/ui/**`, dshx's public `index.ts` entry points and test support
      (`tooling/dshx/scripts/**`, `tooling/dshx/e2e/support/**`). Record the starting count in `scripts/lint-ratchet.json`.
- [x] 11c. Keep the cap at zero and promote to `error` once the product-only scan returns no findings.

**Hotspots to expect first:** dshx `communication/types.ts`, thread-sidebar `organization.ts`, ai-accounts `api.ts`,
thread-sidebar `thread-view-preferences.ts`.

## Step 12 — XState and namespace classes, plugin by plugin

**Why:** logic in components (`useEffect`/`useState` chains) is hard to test and drifts. The pattern
(`~/.agents/skills/actor-state-ownership`, emisoup's `*-machine.ts`):

- `setup({ types, actors })` with placeholder actors that throw.
- A thin `use-*.ts` hook calls `.provide({ actors })`.
- Components only `useActorRef` / `useSelector` / `send`.
- Tags instead of boolean `useState`.
- Each operation carries an identity so stale completions are dropped.
- Machines are tested in Node with `createActor`, `vi.waitFor` and deferred promises.

Pure helpers move behind one namespace class per module (step 11's rule).

**Order** (by hook count today; one plugin per slice, each slice also lowers the step-11 and `exhaustive-deps`
caps):

| #   | Plugin                                                                  | `useEffect`/`useState`/`useLayoutEffect` in `.tsx` | Largest component                                 |
| --- | ----------------------------------------------------------------------- | -------------------------------------------------- | ------------------------------------------------- |
| 12a | thread-sidebar                                                          | 52                                                 | `client.tsx` 2367 lines, `sidebar-shell.tsx` 1690 |
| 12b | settings-shell                                                          | 29                                                 | ported native shell (`src/native/`)               |
| 12c | ai-accounts                                                             | 26                                                 | `settings-section.tsx` 739                        |
| 12d | jujutsu                                                                 | 25                                                 | `client.tsx` 1965                                 |
| 12e | command-palette                                                         | 12                                                 | `thread-palette.tsx` 676                          |
| 12f | jj-integration, secret-catalog, workbench, memory, editor, prompt-stash | 9–11 each                                          | —                                                 |

**Per-plugin slice:**

1. List each stateful flow in the plugin (open/close, async loads, optimistic writes, polling). One machine per
   flow, not per component.
2. Write the machine with its Node tests first (stale-completion and cancel cases included).
3. Swap the component to the hook; delete the `useEffect`/`useState` it replaces.
4. Split oversized components along the machine boundaries, not arbitrarily.
5. Convert that plugin's export bags to namespace classes.
6. `pnpm check` plus `pnpm check:e2e <plugin>` green; lower the caps.

**Risks:**

- thread-sidebar and jujutsu are the most used surfaces: land them in several slices (one flow each), each with its
  journeys green.
- settings-shell's `src/native/` is a port of DSH's compiled shell. Refactor only our additions, so the port stays
  diffable against upstream on DSH upgrades.

## Checklist

- [ ] Step 10 done (10a–10e)
- [ ] Step 11 done (11a–11c)
- [ ] Step 12 done (12a–12f)
- [ ] `plans/guardrails.md` steps 10–12 ticked, then convert both plans to docs with the `complete-plan` skill
