# End-to-end testing

How this repository proves that plugins work in a real DSH, not only that they
compile. The harness lives in `tooling/dshx/e2e`; feature catalogs live beside
each plugin in `dshx.features.json`.

## Why a browser layer exists

Two defects on 2026-10-04 passed `tsc`, `dshx check` and the build, and showed
up only as a card in the browser:

- `queue-reorder` and `ai-accounts` called `ctx.slots.inject(...)` without
  declaring `slots` in `inject`, so `setup` threw inside `apply`.
- Once fixed, queue-reorder collided with `dsh-client-ui-conversation` over the
  `conversation` locale namespace; the Locale runtime rejected the duplicate and
  a shipped plugin failed, taking seven dependents to `pending`.

A jsdom reproduction then produced a false 36-entry failure from its stubbed
`fetch` and a spurious HMR error from a missing `EventSource`. Simulating the
browser is the wrong instrument; the checks below run a real one.

## Layers

Put each check at the earliest layer that can see the defect:

| Defect | Layer | Tool |
|---|---|---|
| Expressible in types | Typecheck | `tsc` |
| Decidable across packages without running them | Static contract | `dshx check` (reserved or colliding locale namespaces, undeclared Client services) |
| Pure logic, no DOM or Host | Unit | Vitest |
| Breaks at boot | Boot smoke | `test:boot`, one real browser over a composed profile |
| Breaks during use | Journey | Gherkin scenarios via `playwright-bdd` |

Boot smoke and journeys share one harness (`e2e/support/boot.ts`): a browser
launch is the expensive unit, so they differ in assertions, not in driver.

The boot smoke composes the checked-in `profiles/web` seed in a scratch
`DSH_HOME`, links every local bundle, and fails on any Client entry in state
`failed`, naming the entry. `pending` is a pass: the smoke runs no
conversation, so entries waiting on `sessions` or `remote.*` cannot become
`active` there. Bundles are discovered from their DSH manifests, so a new
bundle is tested without editing a registry. `scripts/boot-ignore.json` may
skip one, but each entry needs a known package id, a reason, an owner and a
removal condition, and an expired entry fails the check.

## Choices

- **Real Host, never a mock.** Both defects were about services packages
  negotiate through the Host; a mock would reproduce the assumption under test.
  `createTestHost`/`createTestClient` stay for unit tests.
- **Fake only what we do not own,** at its transport boundary: the LLM provider
  (`e2e/support/fake-command-code.ts`), MCP servers (`fake-mcp-server.mjs`),
  the secret CLI (`fake-secret-cli.mjs`), a loopback Framework Hub, models.dev
  pricing and the OptMem summarizer. Repositories, files, SQLite and commands
  are real, in temporary directories. No routine test calls a paid API, uses
  real credentials, or touches a user project.
- **Gherkin for journeys, plain specs for single assertions.** In a spec the
  intent of a journey is buried under selectors, and the shared setup (boot,
  open a thread, send) is the reusable part, which is what step definitions are
  for. A UI change is absorbed in one step file. Gherkin stops paying off past
  about five steps per scenario, and adds nothing to a one-assertion check.
- **Rejected:** jsdom (see above) and Vitest browser mode, which assumes it owns
  the page and starts from a fixture URL, while these tests must boot a profile
  and own a port.
- **The browser is contained.** Every journey routes requests so only the
  scratch profile's origin is reachable (HTTP and WebSocket) and service
  workers are off; `network-boundary.feature` proves external and other
  loopback requests are blocked. Host-side egress is not contained yet.

## Feature catalogs

Each package declares its user-visible features in `dshx.features.json`
(schema in `tooling/dshx/packages/dshx/src/project/features.ts`): id, summary,
surfaces, configuration keys, states, failure modes, external dependencies, and
`verification` entries of kind `gherkin`, `unit-test`, `host-test` or
`not-applicable`. A scenario links back with `@scenario:<id>` on the Scenario
line. `not-applicable` needs a reason of at least 20 characters saying why no
journey can exist (for example multi-host needs an SSH server and a second
runtime). Optional `reach` steps tell `dshx dev open` how to get to the feature
from the app root (see the `verify-dsh` skill).

`features:check` fails on a bundle feature with neither a scenario nor a
`not-applicable` reason, a library feature without a unit test, a missing,
duplicated or misplaced tag, a test name no longer found in its file, or an
orphan tag. It proves the catalog is
consistent, not that it is exhaustive: whether every behavior is listed is a
review question.

"Every feature" means every behavior and every configuration option is
exercised at least once, not the cross-product of settings; combinations go to
unit tests.

## Evidence

Each run writes a bounded receipt (`e2e/support/evidence*.ts`): ordered step
titles and outcomes, failure screenshots and traces with sizes and hashes, the
jj source revision and, in CI, the run URL. Step count, title length, artifact
bytes and retained runs are capped. Prompts, page text, Host stdout and
tokenized URLs are never written. Frame order stays inside the Playwright
trace; the receipt does not invent a step-to-frame mapping.

## Commands

From `tooling/dshx`:

```sh
pnpm run features:check     # catalogs consistent, every feature verified or justified
pnpm run features:report    # coverage report by package and kind
pnpm run test:boot          # build, then boot the composed web profile in a browser
pnpm run test:e2e           # build, generate with bddgen, run every journey
pnpm run test:e2e:gen && pnpm exec playwright test --config=playwright.e2e.config.ts -g "<scenario>"
```

Root `pnpm check:plugin-boot` runs `test:boot`. Root `pnpm check:e2e [filter]`
builds every bundle once, then runs the journeys headless on one worker
(`DSHX_E2E_PREBUILT=1` stops each scenario from rebuilding the bundles it boots)
and ends with a summary: totals, wall time, one line per failure and the
slowest feature files. A filter is a feature-file name such as `thread-sidebar`.
`pnpm check` ends with `pnpm check:e2e:smoke`: the same command filtered to
scenarios tagged `@smoke`, about ten journeys spanning boot, the shared
stylesheet and the most used plugins, so the harness and its shared steps cannot
rot unnoticed. Keep the subset under four minutes; tag a scenario `@smoke` only
when it covers a surface no other smoke scenario does. Smoke is a tripwire, not
coverage: landing a plugin change still needs `pnpm check:e2e <plugin>` green. A fresh clone gets the pinned
Chromium from `pnpm install:all` (`setup:browser`).

In CI, `check.yml` runs `pnpm check`, which includes `features:check`, the
web-profile boot and the `@smoke` journeys. `plugin-e2e-coverage.yml` runs the
inventory and catalog tests, the report and `bddgen` listing; it does not
execute the full journeys yet (see [plans/plugin-e2e-coverage.md](../plans/plugin-e2e-coverage.md)).
