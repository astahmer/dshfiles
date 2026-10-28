# Reference-driven account dashboard

Verification counts below describe the recorded implementation runs, not new
checks performed by documentation sanitation or proof of current deployment.

The page extends the existing owned AI Accounts plugin through supported dshx APIs. It does not replace DSH core, start a second live server, or intercept provider consent.

## Design and delivered screens

| Screen   | Implemented capture                                      |
| -------- | -------------------------------------------------------- |
| Models   | [Models](screenshots/reference-dashboard-models.png)     |
| Settings | [Settings](screenshots/reference-dashboard-settings.png) |
| Usage    | [Usage](screenshots/reference-dashboard-usage.png)       |

The three supplied raw design references are omitted from the public tree
because they contain account-identifying details. Private originals are retained;
they are not claimed to be publication-sanitized. The implemented captures use
synthetic accounts and session records in an isolated stock-core Host. Usage
figures are produced by the real ledger and exact-account SQL aggregation, not
hardcoded into the client.

## Reference checklist

- **Shell:** wide rail with its own title, Add account, search and page-options menu; right detail aligned to the top; container-width adaptation for narrow/split panes.
- **Rail:** compact branded account rows, name pencil, observed identity/plan, connection dot, routing switch, overflow/order actions, selected blue edge and expandable Models/Settings/Usage shortcuts. Built-in providers share the visual list without becoming fabricated account profiles.
- **Header:** provider mark, rename editor, observed identity/plan, status and provider-check time, enable switch, sign-out and overflow. Underlined icon tabs match the reference structure.
- **Models:** favorites, searchable model table, reasoning selector, picker switch, inherited/overridden source badge, row actions, first five rows, accurate expansion count and custom-model disclosure. Inline settings contain account name, priority, default reasoning, inheritance/routing switches and authentication details.
- **Settings:** Account details card with Edit, name/provider/plan/identity, copyable account route ID, authentication and observed status/check time; reauthenticate; routing/priority card; collapsed Advanced settings retaining all existing runtime/path/credential/picker fields.
- **Usage:** 7/30/90-day range, four KPIs and previous-period comparisons; token/request/cost chart with separate units; usage-by-model and usage-by-day tables; recent requests/View all. Subscription quota remains supplementary, not a substitute for request analytics.
- **Authentication:** supported sign-out scopes are explicitly confirmed and preserve the profile. Cancellation never calls sign-out. Existing setup/login methods and provisional adoption remain unchanged.

## Deliberate, truthful differences from mock data

- No fabricated sample email, plan, external provider account ID, token-validity claim, relative check time or activity figure. The copyable identifier is explicitly the DSH route, because no stable provider account identifier is universally available.
- A healthy authenticated quota response earns Connected. Local credential presence alone earns Credentials available, never Valid. Provider check times come from actual readings.
- There is no account-scoped default-model setter in the installed LLM service. The implementation does not fake the mockup's Default model badge or invent a default-model action. Reasoning defaults, favorites and picker order are real supported controls.
- Built-in providers keep their owning plugin's configuration. Their detail pane explains that boundary rather than pretending the account-file editor can mutate native settings.
- Global Command Code/Cursor CLI sessions, externally owned keys, unsafe/shared homes and mixed authentication sources cannot be safely signed out on behalf of one account. Their action is disabled with a concrete reason; disabling routing or deleting a profile is not presented as sign-out.
- Missing Usage owner/new Host support is explicit. A response must confirm the requested exact provider before the client displays it; unscoped totals are never used as account totals.

## Behavior and safety

`inheritModelSettings` and `defaultReasoningEffort` are optional persisted fields, preserving old records. An untouched legacy profile inherits native settings; authored legacy customizations stay active. Inheritance retains local values but pauses them. When active, explicit request controls win over per-model overrides, then a supported account default, then the provider default. Unsupported efforts are never pinned.

The Usage query's optional provider selector is bound as an exact case-sensitive SQL predicate across requests, counts, all chart aggregates and the previous period. Actual serving-route attribution comes from recorded wire evidence rather than the originally selected pool route. SQL totals and mean latency are not inferred from a truncated recent-request page. Missing usage/pricing remains unknown.

Sign-out has a dedicated typed dshx contract with the same agent capability and an explicit `confirm: true`. It checks credential ownership and exclusive scope. Official CLI execution uses fixed arguments and selected private environments, never a shell string or installation helper. Codex uses an unsigned private tombstone to prevent reseeding from shared credentials. One canonical-home owner excludes nominal materialization and the entire token-refresh read/modify/persist sequence during logout, including path aliases; unrelated homes remain concurrent. Ordinary credential reads/materialization/refreshes serialize in a bounded FIFO (128 waiters, 60-second wait limit) instead of failing simultaneous chats. Cancellation or expiry removes only a waiting call, never the active operation. Destructive sign-out remains fail-fast and is never silently queued; ordinary access during active logout is refused. Filesystem type, link count, ownership, writable modes and trusted ancestry are validated, including both Claude credential/config files. Cached/in-flight quota data is invalidated without accepting late pre-logout reads.

## Verification

- Final merged unit runs: AI Accounts **1,003 tests / 100 files**, Usage **86 tests / 17 files** passed; account and usage typechecks passed. One unchanged main Usage test timed out under concurrent load, then passed in 70 ms alone and 128 ms during a clean full-package retry; no timeout was increased. Canonical-home/filesystem races and sign-out telemetry/redaction are covered.
- All **31 browser journeys** passed across the complete run and focused reruns, not one uniform final run. These include populated dashboard, star/visibility persistence after reload, routing synchronization, sign-out confirmation cancellation, manual save, removal, priority/sidebar synchronization, unavailable quotas, Fast mode/fallback, and complete provisional-login cancellation/restored-method paths. The wider run exposed stale picker artifacts/Usage workspace fixtures plus real cooldown and hourly-chart regressions, all repaired without weakening assertions. The final three Usage journeys passed in 33.8 seconds with zero console, page or HTTP errors. Reload-cancelled EventSource connections were explicitly classified as `net::ERR_ABORTED`.
- Desktop primary captures are 1536 pixels wide inside the actual app. Additional full-app captures cover 1536/1024/768/480/360 and all three tabs in dark mode; document-overflow checks and strict per-tab bounds passed. Copy account ID is verified through the real browser clipboard; no false success is shown when copying fails.
- A real route cooldown now takes precedence over an older healthy quota reading. Global Usage Charts/Tools retain raw epoch bucket positions and format only display labels, preventing duplicate-stack crashes across hourly data and DST-repeated local hours. Tests preserve all values instead of dropping or coalescing records.
- A live restored-chat failure exposed over-strict normal credential contention after the dashboard activated. Two deterministic regressions reproduced simultaneous materializer/refresh rejection; the FIFO fix passes concurrent reads, fresh read-after-refresh, logout exclusion, alias safety, waiter cancellation/expiry and async-owner isolation checks. This final Host-only follow-up is verified by the complete account unit suite; real multi-chat recovery after activation remains unverified.
- The repository-wide formatting/lint commands were also run. Remaining findings outside the owned edits are not rewritten as part of this task; the workspace lint ratchet still reports its own pre-existing findings/caps.
- All test provider endpoints/CLIs are synthetic. No real consent, login, logout or provider traffic was performed. Real installed-provider approval/logout remains human-dependent.
- After retaining current main, catalog/telemetry coverage, generated browser recipes and screenshot registration pass. The workspace-wide contract remains blocked only by the pre-existing user-questions missing test script, independently verified on main; this dashboard does not edit it.

## Activation

Host APIs, persisted model settings, sign-out and scoped analytics changed together. The historical canonical build covered AI Accounts, Usage and UI Styles (nine build tasks); both Host bundles imported on official Node 22.23.3. The ordinary-credential concurrency follow-up also passed unit/type/import checks, but real multi-chat recovery after activation remains unverified. Private live profile and endpoint observations are omitted. These historical checks do not certify a current deployment. Paired Host/client changes require a user-managed restart; older Hosts show unsupported/unavailable states instead of false success. Verification did not restart or kill the live DSH.

### Reproduce the checks

```sh
fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/ai-accounts test --maxWorkers=1
fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/usage test --maxWorkers=1
fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/ai-accounts typecheck
fnm exec --using=22.23.3 pnpm --dir plugins/@dshfiles/usage typecheck
fnm exec --using=22.23.3 pnpm --dir tooling/dshx run features:check
fnm exec --using=22.23.3 node tooling/dshx/scripts/browser-tasks.mjs
fnm exec --using=22.23.3 node --run check:screenshots
```

Browser journeys use the isolated stock-core fixture, with the raw-core executable and system Chrome supplied to the runner, never the personal `dsh` wrapper. Keep built artifacts frozen during each browser run. Use the package `test:e2e` journeys for AI Accounts and Usage; the fixture seeds synthetic provider/session data and cleans up its own processes.
