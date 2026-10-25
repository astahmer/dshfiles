# Quick setup verification

AI Accounts owns both the provisional connection and final account admission.
There is no second account list, keystore, authentication owner or DSH core patch.

## Admission invariant

Selecting any of the six providers creates only an ephemeral Host operation.
Candidates are absent from the saved account file, normal read/usage APIs, quota
sidebar and model routes. Cancel/X/Escape, expiry and rejected verification add
nothing. Old Hosts lacking the new methods fail closed: the client never falls
back to the old eager account-creation API.

Admission checks the explicitly selected source. Provider-based paths require
fresh authenticated evidence, separately from displayable quota; a nonempty key,
inert auth file, cached success or generic HTTP 200 is not proof. Authenticated
exhausted, unlimited and recognized null quotas are accepted; malformed,
unauthenticated, transient-error and timeout responses are not.

Claude subscription is delegated to the unmodified official CLI's
`auth status --json`: successful exit with typed `loggedIn: true` establishes
**authenticated configuration only**, not remote provider validity. It preserves
supported Host Claude Code environment and uses the exact selected config directory,
matching inference's setting-source isolation. Missing numeric quota cannot block
this existing native CLI mode. No third-party OAuth, DSH-owned refresh or paid
inference is added.

Claude API/setup-token paths use the supplied credential at the actual official
inference origin and the documented free, nongenerative `messages/count_tokens`
endpoint. A typed successful token count is required; there is no CLI dependency
or fallback to another login. Actual setup-token endpoint authorization is not
established by synthetic tests and remains unverified. Denial fails honestly;
it is not silently accepted or converted to paid inference.

## Login compatibility

| Provider       | Available before saving                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Claude         | Subscription/no-key; existing default or custom CLI directory; API key or setup token; existing credential reference.                |
| Codex          | Official device flow; manual/existing CLI login; custom shared home and distinct auth overlay under the existing containment policy. |
| Command Code   | New/imported key; existing/default named key; explicit `cmd login`; allowed custom base in every method.                             |
| Cursor         | New/imported token; existing named token; explicit `cursor-agent login`; quota-only.                                                 |
| OpenCode Go    | New/imported key or existing/default `OPENCODE_API_KEY`; no invented CLI OAuth.                                                      |
| GitHub Copilot | Official device OAuth and saved-account reconnect; quota displayability does not determine authentication success.                   |

An optional persisted `authSource` pins Command Code/Cursor CLI versus reference
selection through observation, inference, discovery and subsequent edits. Missing
explicit references never silently choose OS auth. Absent fields preserve legacy
auto-source behavior. Changing methods cancels and settles previous device work
before applying; allocated temporary resources are tracked independently from
user-selected existing homes. Copied login commands shell-quote selected paths.

## Reproducible checks

Run from a development checkout after installing its locked dependencies:

```sh
pnpm --dir plugins/@dshfiles/ai-accounts typecheck
pnpm --dir plugins/@dshfiles/ai-accounts test --maxWorkers=1
pnpm --dir plugins/@dshfiles/ai-accounts build
node -e "import('./plugins/@dshfiles/ai-accounts/dist/index.js')"
node -e "import('./plugins/@dshfiles/ai-accounts/dist/account-login-api.js')"
pnpm --dir tooling/dshx run features:check
```

Rebuild the shared stylesheet owner for client class changes. Browser verification
must use a disposable DSH home, synthetic credentials, fake CLI/device responses
and a loopback provider—not the user's profile or real provider authentication.
The feature catalog names the relevant browser journeys and unit regressions.

Required coverage includes all-provider dismissal, delayed preparation and key
writes, cancellation/expiry during verification, rejected and malformed provider
responses, unlimited/exhausted quota, exact CLI/reference source pinning, safe
Codex overlay adoption and cleanup, restored login choices, page/sidebar priority,
foreground-chat attribution, and unavailable-quota recovery. Preserve upstream
quota-recovery session identity and provider-request tracing regressions too.

Verification from another checkout or earlier source revision is not proof for
this consolidated patch. Fresh build, test, catalog and browser results must be
reported separately. Real provider validity, billing, installed CLI compatibility,
setup-token endpoint permissions and cross-OS behavior remain unverified by the
synthetic checks.

### Consolidated patch evidence

Against current upstream, the combined patch passes 854 account tests across
89 files, ten credential-port tests and seven scoped resolver tests. Account,
credential-port, Secret Catalog and dshx typechecks pass, along with 23 dependency
build tasks and Host/public-login module imports. Existing upstream recovery
session identity and provider-request tracing are preserved. Scoped lint has no
errors; existing advisory warnings remain.

Ten focused system-Chrome journeys pass on the combined code: Copilot setup,
manual save, all-provider cancellation, restored methods, reference/CLI source
pinning, unavailable-quota recovery, shared priority, foreground-chat attribution,
failover attribution and Priority cooldown. An additional responsive check passes
at 360, 480, 768 and 1024 pixels. These use the stock installed core, disposable
homes and loopback providers; no real provider sign-in or credentials. Temporary
local binary/browser selection overrides were restored and are not part of the
patch. All owned verification processes stopped. Full global E2E/smoke and legacy
Codex model-catalog journeys were not run.

The global catalog check reports the same unrelated orphan Backlog board-columns
tag on untouched upstream. Generated recipe checking also retains unrelated
Pulls Review and Thread Sidebar baseline drift. The account-related generated
model-picker input is included; unrelated recipe output is not.

### Screenshot provenance

The account-page and unavailable-quota README captures are retained synthetic
source-patch images. Quick setup is freshly captured against this combined patch
using the scrubbed `/scratch/custom-claude` example. All show synthetic account
state and no actual credential values, consent codes or user identifiers. Only
the fresh quick-setup capture represents this consolidation's browser run.

## Authentication and secret boundaries

Pending keys and Copilot grants stay in Host memory. Codex output stays in its
owned stage, including an existing account's reauthentication. The accepted
verified commit writes through the existing native credential owner and publishes
the account under the account-store writer guard; normal key metadata/editing
continues to use that owner. Device instructions are browser-only. Secret Catalog
imports require an owner explicitly advertising exact-scope support and enforce
the selected scope before reveal; older owners cannot silently ignore the check.

A commit already accepted after verification cannot be rolled back by closing
the UI. Native credential writes and account-file publication are not one
transaction: actual disk failure after a unique native key write can leave an
unreferenced private credential, but no new account entry. No unsafe
read-then-delete compensation is attempted against a concurrent writer. Mutable
external key references, malicious same-UID processes and cross-process atomicity
are not claimed protected by a single Host queue.

## Sidebar visibility when quota is unavailable

Visibility follows enabled/explicit-hidden preferences, not quota status.
Credential availability is not proof that a provider accepts it now. An
unavailable summary is a typed alternative with no numeric percentage/reset
fields. The sidebar, collapsed rail, edge widget and visible usage cards keep
those accounts reachable with a reason. Unknown quota never enters numeric
critical-account ranking. Canonical account priority and session-before-weekly
window order remain unchanged; explicit hiding and active-wire attribution keep
their existing behavior. The last-good transient-error cache policy is unchanged.

## Reauthenticate from a quota card

A card whose usage status is `unauthenticated` offers **Reauthenticate**. It
closes the popover and calls the same existing-account setup controller as the
account page, passing that card's exact account ID. Opening the popover alone
never starts setup. The action only opens the dialog: provider login,
credential replacement and verification still require their existing explicit
steps. Cancel preserves the existing account and credential reference. Healthy,
rate-limited and otherwise unavailable quota cards do not imply signed-out state
and do not receive this action. Sidebar, collapsed rail and edge popovers share
this behavior.

Verified: 865 account tests pass, including 32 actual quota-surface component
cases. Exact-account callbacks, popover closure and absence of the action on
non-authentication failures are covered across strip, rail and edge.

## Refreshed upstream-based verification (25 October 2026)

Re-extracted on upstream `04d6c5ee5156a5f18c45273eca440cdbb3ab63c7`.
The later minimal dialogs, provisional name editing, exact-account reauthentication,
failed-login cleanup and JSON-safe reconnect receipts are included. An unreadable
completion receipt is an unknown result, not proof that authentication failed;
the client avoids unsafe duplicate sign-in and offers closing/checking accounts.
Absent optional credential ownership is omitted before the strict JSON response.

Fresh isolated checks: 923 account tests, ten credential-port tests, seven scoped
resolver tests, account typecheck, dependency builds and Host/login-module imports
pass. Seven actual system-Chrome journeys cover all-provider cancellation,
restored methods, verified reference/CLI reuse, rejected-quota recovery, canonical
priority synchronization, foreground-chat attribution and failover. Provider and
CLI work units have checked redacted telemetry. No real provider consent, paid
inference, cross-OS behavior, full repository gate or live deployment is claimed.
Unchanged upstream annotations catalog/tracing findings remain outside this patch.

## Activation

Host API/storage changes require a user-managed Host restart. Client-only changes
require a rebuilt client and shared stylesheet; automatic delivery depends on the
running development watcher. An older Host remains supported without pretending
new methods succeeded. Previously saved incomplete profiles are not automatically
removed. No profile modification, real sign-in or running-instance restart is
part of automated verification.
