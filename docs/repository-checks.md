# Repository checks

How to run this repository's checks, and the traps measured on 2026-10-18 that
cost whole minutes. `AGENTS.md` keeps the short version; this page is the detail.

## `node --run` over `pnpm run`

Run a single script name with `node --run <script>`, not `pnpm run <script>`: the
wrapper costs ~170-400 ms for nothing (medians — `check:diff` 350 ms via
`pnpm run`, 184 ms via `node --run`, 127 ms calling `scripts/check-diff.mjs`
directly; `jj:state --read-only` 830 / 591 / 430 ms). Call the script path
directly in a loop you repeat within a session.

`node --run` forwards arguments only after `--`
(`node --run jj:state -- --read-only`) and skips `pre*`/`post*` lifecycle hooks,
which this repository does not use. **A bare argument is dropped silently**, not
rejected: `node --run check:e2e workbench` ran every journey in the repository
(measured: 50 minutes) where the caller meant one owner, so pass a script
argument with `pnpm run <script> <arg>`, with `node --run <script> -- <arg>`, or
through the check's own environment variable
(`DSHX_E2E_ONLY=workbench node --run check:e2e`). `check:e2e` now refuses a broad
run without `--all`, so the mistake costs a second instead of an hour. Keep
`pnpm run` where Turbo does the real work: minutes of Turbo swamp the wrapper
either way.

## Browser routing disables HTTP cache

Playwright disables HTTP caching whenever `page.route()` or
`browserContext.route()` is registered, even for an unrelated URL. Confirmed
with installed Playwright 1.56.1 and bundled Chromium: a cacheable script loaded
on two consecutive navigations produces zero second-navigation server hits
without routing and one with a catch-all continue route.

Our shared E2E hook in
[`steps.ts`](../tooling/dshx/e2e/support/steps.ts) deliberately routes every HTTP
request to block origins other than the scratch Host and explicitly admitted
loopback fakes. Consequently, all journeys run without normal HTTP caching;
reload timings are not representative of a user's warm browser. The additional
routes in Settings, upload and JJ journeys hold or fail requests deterministically;
removing those alone would not restore caching while the shared guard remains.

Do not replace the guard with an `addInitScript` fetch/XHR patch: that misses
scripts, images, frames and document navigations. Do not override cache state
through a second CDP session or patch Playwright internals. A cache-preserving
replacement must enforce the same origin policy across browser requests,
including popups and redirects, before replacing the guard. Until then, retain
routing for isolation and measure user-facing warm-cache performance separately
in a controlled browser without HTTP routes.

Run the real Chromium regression independently with
`pnpm --dir tooling/dshx run test:browser-cache` (also included in tooling tests).
It checks cold and repeated loads against a fixture-owned loopback server for
three fresh contexts: no routes, an exact-origin guard, and an unrelated API
route. Assertions use server hits and transfer bytes, not flaky timing budgets.

Run `pnpm --dir tooling/dshx run benchmark:browser-cache` for a separate JSON
report with navigation duration, asset requests, transfer bytes and server hits.
Only the route-free context's repeated loads are labeled warm; routed repeats
are explicitly labeled cache-disabled. The route-free probe serves only local
static fixture content, never DSH, credentials or arbitrary URLs. Do not remove
the functional journeys' guard to obtain a warm-cache number.

Sources: [Playwright routing contract](https://playwright.dev/docs/api/class-browsercontext#browser-context-route)
and [upstream cache discussion](https://github.com/microsoft/playwright/issues/22865#issuecomment-6357778607).

## The order

From `plugins/`: `node --run contract`, then the Turbo tasks `pnpm run build`,
`pnpm run typecheck`, `pnpm run test` (the order `check:plugins` uses). The root
`pnpm run check` adds dshx, desktop, scripts, web-profile contract, `lint` and
`fmt:check`.

`lint` ratchets Oxlint and the ast-grep rules (`node --run sg`): any error, or a
rule exceeding its cap in `scripts/lint-ratchet.json`, fails; lower a cap when
you fix sites, never raise it.

`node --run check:diff` lints and format-checks only the paths your revision
touches, and, when the revision touches a plugin or the catalog checker, runs
the feature-catalog check (Gherkin and telemetry coverage, a few seconds);
`node --run check:green` runs everything except lint/format.
`check:green` ends with `check:plugin-boot` and `check:e2e:smoke` (the `@smoke`
journeys only); before landing a plugin change, also run
`pnpm run check:e2e <plugin>` (its journeys, headless, serial; `node --run` would
drop the name) green, or `DSHX_E2E_ONLY=<plugin> node --run check:e2e`. A broad
journey run needs `pnpm run check:e2e --all`: it is the pre-land or post-merge
gate, not the iteration loop.

All three are Turbo tasks keyed on the built bundles they boot, so an unchanged
package replays from cache in seconds; `--force` reruns everything (see
[`e2e-testing.md`](e2e-testing.md#cached-browser-tasks)). Do not reach for
`--force`/`TURBO_FORCE` while iterating: 210 forced browser runs cost 3.7 h of
wall time across the 2026-10-15..18 window. Scope the run instead, and force only
for the pass before landing or when a binary outside the repository changed.

After adding or retagging a feature file, run
`node tooling/dshx/scripts/browser-tasks.mjs --write`.
