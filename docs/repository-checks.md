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

For a plugin change, use `pnpm test:related <changed-file>` or
`pnpm test:changed --from <base>` to select relevant tests; avoid running the
plugin's entire test suite or root `pnpm run check` by default. Add package
build/typecheck or only the E2E journey that exercises the changed behavior
when needed. The complete `check:plugins` and root `pnpm run check` remain
available as broader gates when a change crosses contracts or a pre-landing /
release check calls for them. See [incremental checks](incremental-checks.md#test-selection)
for selector behavior and full-suite fallbacks.

`lint` ratchets Oxlint and the ast-grep rules (`node --run sg`): any error, or a
rule exceeding its cap in `scripts/lint-ratchet.json`, fails; lower a cap when
you fix sites, never raise it.

`node --run check:diff` lints and format-checks only the paths your revision
touches, and, when the revision touches a plugin or the catalog checker, runs
the feature-catalog check (Gherkin and telemetry coverage, a few seconds);
`node --run check:green` runs everything except lint/format.
`check:green` ends with `check:plugin-boot` and `check:e2e:smoke` (the `@smoke`
journeys only). For plugin iteration, run only the E2E scenario(s) that exercise
the changed behavior, e.g. `DSHX_E2E_ONLY=<plugin> node --run check:e2e` when the
plugin's scenarios are the relevant scope. Running every journey for a plugin
(`pnpm run check:e2e <plugin>`, headless and serial; `node --run` would drop the
name) or all repository journeys via `pnpm run check:e2e --all` is a broader
pre-land/release gate, not the default iteration loop.

All three are Turbo tasks keyed on the built bundles they boot, so an unchanged
package replays from cache in seconds; `--force` reruns everything (see
[`e2e-testing.md`](e2e-testing.md#cached-browser-tasks)). Do not reach for
`--force`/`TURBO_FORCE` while iterating: 210 forced browser runs cost 3.7 h of
wall time across the 2026-10-15..18 window. Scope the run instead, and force only
for the pass before landing or when a binary outside the repository changed.

After adding or retagging a feature file, run
`node tooling/dshx/scripts/browser-tasks.mjs --write`.

## Design and copy ratchets

Two scripts hold [DESIGN.md](../DESIGN.md) and the copy glossary
([ADE plan §3](ade-ux/README.md#glossary-enforced-in-copy)) against drift. Both
count findings per `rule/plugin` against a checked-in baseline and fail only when
one count rises, so a fix in one plugin cannot hide a regression in another.
Both run in `check:green` and in CI's `repo` job, each in about a second.

```sh
node --run check:design-tokens              # or check:copy: compare with the baseline
node --run check:design-tokens -- --report  # list every finding: rule, file:line, excerpt
node --run check:design-tokens -- --update  # rewrite the baseline at today's counts
```

Run `--update` after a fix, to ratchet the counts down, and review the baseline
diff: it rewrites every key, so an unnoticed rise elsewhere would be accepted
too. Never raise a count to land new code; fix the code. A rule that
misfires is fixed in the script, with a test.

`scripts/design-token-check.ts` reads every plugin's `src` (vendored forks
included; tests, `.d.ts` and comment lines excluded) and parses each `dshx:`
class into its variants and utility:

| Rule                       | Counts                                                                                                   |
| -------------------------- | -------------------------------------------------------------------------------------------------------- |
| `arbitrary-text`           | `text-[…]`                                                                                               |
| `arbitrary-radius`         | `rounded-[…]`, and a CSS `border-radius` literal other than 0, pills and variables                      |
| `raw-colour`               | hex, `rgb()`, `hsl()` and `oklch()` literals outside the token files                                     |
| `native-icons`             | `Icon…OutlineRegular` imports, once per icon per file                                                    |
| `default-shadow`           | `shadow-2xs..2xl` (the kit maps them onto the levels; new code writes `shadow-s0..s3`)                    |
| `numeric-duration`         | `duration-<number>` and `duration-[<time>]` instead of `duration-(--dshx-duration-*)`                    |
| `viewport-variant`         | a `sm:`/`md:`/`lg:`/`xl:`/`2xl:` (or `max-*`) variant, except a dialog's `max-w-*` width                 |
| `solid-status-fill`        | solid `bg-info`/`bg-success`/`bg-warning`, or a status or health role (`bg-status-ready`, `bg-health-down`), outside `plugin-ui`; `bg-control-on` (a control's on state) is allowed |
| `chart-hue`                | `chart-1..5` colour classes outside the kit's chart component: an identity uses `identity-1..8`, a chart series `data-1..6` |
| `palette-colour`           | numbered Tailwind palette classes (`bg-emerald-500`)                                                     |
| `uppercase`                | the `uppercase` class and CSS `text-transform: uppercase`                                                |
| `local-duration-formatter` | a `formatElapsed`, `formatDuration` or `formatClock` defined outside `plugin-ui/src/lib` (an alias, a one-line wrapper that calls `formatElapsed`/`formatDurationMs`, and a `Date` clock-time formatter are not counted), and a `padStart(2, '0')` on a line that prints a unit right after an interpolation (`${s}s`, `${m}m`, `${h} h`) |
| `unguarded-loop-animation` | `animate-spin`/`animate-pulse` when no class in the same list has a `motion-reduce:`/`motion-safe:` variant |
| `outline-without-focus`    | `outline-none` on a button, link, summary, `*Trigger` or widget-role element with no `focus-visible:`/`focus-within:` class in the same list |

The last two read a whole class list: a string literal, template holes
included, joined with its neighbours when only `,` or `+` separates them, as
in a `cn()` call over several lines.

`local-duration-formatter` holds [DESIGN.md › Durations](../DESIGN.md#durations):
one grammar, from `@dshfiles/plugin-ui/lib/format-duration`. It reads one line
at a time, so it is a heuristic: a time of day (`${hh}:${mm}`) and a UTC offset
print no unit and are not counted, and a wrapper that calls the kit across
several lines still counts until it fits on one. Its 2026-11-24 baseline is 12
(agent-plan 3, thread-sidebar 4, turn-summary 2, ai-accounts 1, chat 1,
tool-meta 1); round three of the unslop plan removes most of them.

`scripts/copy-check.ts` reads `.tsx` files and locale tables (non-English
tables skipped), the `.description(…)` text of `defineSettings` schemas,
label-keyed values in plain `.ts` tables (`label`, `title`, `placeholder`, …;
`description` and `summary` only in files that define no tool, API or schema),
each plugin's `locale/en.json`, and the catalog's `title`, `summary`,
`onboarding.firstAction`, `onboarding.doneWhen` and quoted `reach` labels:

| Rule                                                       | Counts                                                                                         |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `session`, `conversation`, `new-chat`, `integrate`, `settle` | the glossary's banned words in prose                                                           |
| `plugin-prefix`                                            | a `Plugin Name: View` label, template literals included (`` `AI Accounts: ${…}` ``)             |
| `host-process`                                             | a capital "Host" inside a sentence (the server process); lower-case host is a machine           |
| `package-name`                                             | `@dshfiles/…` or `@deepseek-ai/…` in a sentence                                                |
| `raw-error-echo`                                           | a message ending in `: {message}` or `: ${error…}` with no next step                           |
| `transport-failure`                                        | the text "transport failure" (DSH Connection's own message) in copy; use `errorSentence`       |
| `code-echo`                                                | a template ending in `(${…code})`, as in `` `${error.message} (${error.code})` ``; the code goes under Details |
| `status-word`                                              | Running, Completed, In progress, Finished, Succeeded, Inactive, Input needed or Needs attention as a whole label |
| `try-again`                                                | "Try again" as a whole label (use Retry)                                                       |
| `ascii-ellipsis`                                           | three dots after a word instead of …                                                           |

`transport-failure` and `code-echo` came with round four of the unslop plan
(2026-11-25), baselined at 0 and 6 (jj-integration 1, model-effort-picker 2,
multi-host 1, rich-composer 2); `errorSentence` in
`@dshfiles/plugin-ui/lib/error-copy` is the replacement.
