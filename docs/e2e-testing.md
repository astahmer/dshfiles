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
| Breaks at boot | Boot smoke | `check:plugin-boot`, one real browser per bundle and over the composed profile |
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
removal condition, and an expired entry fails the check (validated uncached on
every run, since no cache key sees the date).

A Client entry can also reach `active` and then throw while rendering its Slot.
The boot audit stays clean, so the boot smoke reads the two traces the browser
leaves: the renderer's `[data-slot-error]` marker when the cell went dry, and the
`slot entry crashed in '<slot>'` console line it logs before a shadowing cell
retires the entry onto the cell's next survivor. Reading only the marker passes a
takeover: `@dshfiles/thread-sidebar` lost its whole sidebar to the stock
workspace browser that way, because `sidebar.workspaces` is a shadowing single
cell and a native entry was still registered behind it.

## Choices

- **Real Host, never a mock.** Both defects were about services packages
  negotiate through the Host; a mock would reproduce the assumption under test.
  `createTestHost`/`createTestClient` stay for unit tests.
- **Fake only what we do not own,** at its transport boundary: the LLM provider
  (`e2e/support/fake-command-code.ts`), MCP servers (`fake-mcp-server.mjs`),
  the secret CLI (`fake-secret-cli.mjs`), a loopback Framework Hub and a seeded
  models.dev price cache. Repositories, files, SQLite and commands
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

Failure diagnostics are retained beside them as
`attachments/NNN-browser-diagnostics.json` (`kind: diagnostics`): the scratch
Host's output and pid/exit state, browser console and page errors, failed
requests, HTTP ≥ 400, the `/api` traffic and WebSocket lifecycle, and whatever
in-page trace the journey recorded. Read that file before the test error — it
separates "the page never asked" from "the page asked, and something else
removed what the assertion was reading". (`application/json` used to have no
entry in the receipt's format table, so this file was silently dropped.)

## Commands

From `tooling/dshx`:

```sh
pnpm run features:check     # catalogs consistent, every feature verified or justified
pnpm run features:report    # coverage report by package and kind
pnpm run test:boot          # uncached: build, boot each bundle alone, then the composed web profile
pnpm run test:e2e           # uncached: build, generate with bddgen, run every journey
pnpm run test:e2e:gen && pnpm exec playwright test --config=playwright.e2e.config.ts -g "<scenario>"
```

Root `pnpm check:e2e [plugin|feature ...] [--force]`, `pnpm check:e2e:smoke` and
`pnpm check:plugin-boot` are the cached entry points (`scripts/check-browser.mjs`):
they build every bundle once, then run per-package Turbo tasks headless, with
`DSHX_E2E_PREBUILT=1`. Journeys run one at a time (`--concurrency=1`: each boots
a Host and a Chromium, and parallel journeys are flaky under load); the boot
gate runs no journey, so it overlaps three checks off CI, and
`CHECK_BROWSER_CONCURRENCY` overrides either. Each task prints the journey
summary (totals, wall time, one line per failure, slowest files). A filter is a
plugin (`mcp-servers`) or a feature-file name (`ai-accounts-copilot` runs its
owner, `ai-accounts`). A fresh clone gets the pinned Chromium from
`pnpm install:all` (`setup:browser`).

### Provider credentials

A journey that sends a message needs a working provider route, and the scratch
profile defaults to `deepseek-official`. In an environment without
`DEEPSEEK_API_KEY` (or an account row serving that route) every turn ends with
*no API key for provider route "deepseek-official"*, and the message-sending
journeys then sit out their full 300 s timeout while the journeys that only
drive the UI pass — an environment failure that reads like a product
regression. Check for that Failed turn in the failure snapshot before believing
one. Run a single stack at a time for the same reason `check:e2e` uses
`--concurrency=1`: parallel Hosts and Chromiums make the timing-sensitive
journeys flaky.

A profile without a working route loses the conversation, not just the turn:
the turn ends immediately, and the client then puts the New thread screen back
and unmounts the messages. A journey that reads something inside a message — a
citation, a reference — after sending one is therefore racing a DOM that is
about to disappear, and re-asking does not help because the element it clicks
is gone. `memory.reference-preview` measured it: five of five failing runs lost
the citation outright and eight of eight passing runs kept it, while the
preview RPC answered `200` and rendered the note text in both. A journey that
needs a message to outlive its own assertion runs a real turn on the local fake
provider and waits for it to settle: boot the composition with
`@dshfiles/ai-accounts`, add the fake Command Code account
(`startFakeCommandCode`), then `startThreadWithModel` + `sendMessage` before
asserting — `jujutsu.chat-references` and `memory.reference-preview` are the
pattern.

`pnpm check` runs `check:plugin-boot` and then `check:e2e:smoke`: the
`@smoke` scenarios, about ten journeys spanning boot, the shared stylesheet and
the most used plugins, so the harness and its shared steps cannot rot
unnoticed. Keep the subset under four minutes on a cold cache; tag a scenario
`@smoke` only when it covers a surface no other smoke scenario does. Smoke is a
tripwire, not coverage: landing a plugin change still needs
`pnpm check:e2e <plugin>` green.

## Cached browser tasks

Each package that owns feature files has `test:e2e` (and `test:e2e:smoke` when
it owns `@smoke` scenarios); each bundle has `test:boot`; the `plugins`
workspace (`dshfiles-plugins`) owns the untagged cross-plugin features and the
composed web-profile boot. A feature belongs to the package most of its
`@scenario:` tags name. `tooling/dshx/scripts/browser-tasks.mjs --write`
generates those scripts and each package's `turbo.json` from the feature files;
`dshx check` runs it without `--write` and fails on drift, so add or retag a
feature, then regenerate.

A task's key is what it actually runs, never a build hash and never the sources
behind the built artifact. `@dshfiles/ui-styles` is the only bundle that
compiles the shared stylesheet — its `@dshfiles/ui-styles#build` fingerprint
carries the `$TURBO_ROOT$/plugins/@dshfiles/**` all-plugins scan — so a class
change moves the owner's digest, not every consumer's: only the owner's build
re-runs (plus the changed plugin's), and only the boot tasks that boot the owner
or the changed bundle re-run — the composed web-profile boot and the changed
plugin's own — while the per-bundle isolation checks stay cached. Measured on
this machine, adding one class (`dshx:contrast-125` in `tool-meta`) went from 46
build tasks in ~1m43s followed by 43/43 boot tasks missing to 47 tasks with 45
cached in 2.4s and 3/44 boot tasks missing (the edited plugin, the owner, the
composed profile), the other 37 bundles byte-identical; a no-change re-run of
that 44-task boot gate replays FULL TURBO in 5s. The digest also leaves `*.map`
and `*.d.ts` out, so a formatting-only edit that keeps a bundle's JavaScript
byte-identical does not move its `dist`. The inputs are:

- a digest of the runtime `dist`, the `package.json` and the
  `cordis.patch.yml` of every bundle the package's journeys boot (the packages
  their Given steps name, every bundle for a step that boots the web profile)
  and of their workspace dependencies, dshx included. A journey that boots a
  plugin-ui consumer also reads the owner's digest, because a sheet change can
  change what it asserts; the per-bundle boot check stays isolated and never
  reads it. Maps and declarations stay out because a formatting-only change to
  plugin-ui rewrites the source maps of every bundle that inlines it while their
  JavaScript stays byte-identical, so hashing maps would rerun all their
  journeys for nothing.
  A dshx source edit that compiles to the same JavaScript therefore keeps the
  browser tasks cached, while one that changes the boot check invalidates them
  through the rebuilt digest;
- its feature files and the step files their steps match (plus the step files
  those import); a step no expression matches makes the package depend on every
  step file and bundle, and the planner test fails on it;
- `pnpm-lock.yaml` (DSH, Playwright and Chromium versions) and the
  `profiles/web` seed, for every browser task;
- the journey harness (`e2e/support/*`, fixtures, the Playwright config,
  `run-e2e.mjs`) for `test:e2e`, and `boot-check-web.mjs`, `plugin-inventory.mjs`
  and `boot-ignore.json` for `test:boot`: the boot gate runs its own entry point
  and never loads the journey harness, so editing a shared step file must not
  rerun forty boots;
- env `CI` and `DSHX_TOOL_VERSIONS` (the `jj --version` the Host runs).

Journeys and boots copy registry dependencies from the checked-in
`profiles/web` seed, not the live `~/.dsh` profile, so nothing outside the
repository changes a result. Turbo drops gitignored files under a task's own
package directory, even through a `$TURBO_ROOT$` glob, so a package would not
see its own `dist` and the `plugins` workspace would see none: the entry points
write each package's digest to `.turbo/browser-dist/` after building, and
tasks key on those files.

Every JJ workspace of this repository shares one Turbo cache,
`${XDG_CACHE_HOME:-$HOME/.cache}/dshfiles/turbo` (`scripts/turbo-cache.mjs`,
exported by the dev shell and passed on by the check entry points). Turbo keys a
task on the content of its inputs, not on the directory it runs in, so a fresh
thread workspace replays the builds and browser checks another workspace already
ran; a per-workspace `.turbo/cache` starts empty, which is what made a
plugin-only change re-boot every bundle once per workspace.

To bust the cache: `--force` reruns everything (do it after changing anything
the inputs above cannot see, such as a system binary other than jj), and
deleting that shared directory clears it for every task and workspace. A result
is only as fresh as the built bundles, which is why the entry points always
build first. `TURBO_FORCE` bypasses the cache the same way from the environment,
and the check entry point prints a warning for either. Forcing is expensive and
easy to reach for out of habit — a forced `check:e2e` reruns every journey
instead of replaying the unchanged ones, and 210 forced browser runs across the
2026-10-15..18 window measured 3.7h of wall time — so scope the run
(`pnpm check:e2e <plugin>`) rather than forcing the whole suite while iterating.

In CI, `check.yml` runs `pnpm check`, which includes `features:check`, the
web-profile boot and the `@smoke` journeys. `plugin-e2e-coverage.yml` runs the
inventory and catalog tests, the report and `bddgen` listing; it does not
execute the full journeys yet (see [plans/plugin-e2e-coverage.md](../plans/plugin-e2e-coverage.md)).
