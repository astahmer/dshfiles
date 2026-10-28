# Quick setup verification

Historical implementation evidence below is retained with its original focused
counts and limits; prose sanitation does not rerun those checks or certify a
current deployment. Private live account/authentication/quota observations are
omitted rather than recast as synthetic proof.

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

## Restored login compatibility

The pre-wizard editor allowed configuration before the first save. The wizard
hid these controls; preserving the legacy transports alone did not preserve
onboarding. The pending connection now restores:

| Provider       | Available before saving                                                                                                              |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Claude         | Subscription/no-key; existing default or custom CLI directory; API key or setup token; existing credential reference.                |
| Codex          | Official device flow; manual/existing CLI login; custom shared home and distinct auth overlay under the existing containment policy. |
| Command Code   | New/imported key; existing/default named key; explicit `cmd login`; allowed custom base in every method.                             |
| Cursor         | New/imported token; existing named token; explicit `cursor-agent login`; quota-only.                                                 |
| OpenCode Go    | New/imported key or existing/default `OPENCODE_API_KEY`; no invented CLI OAuth.                                                      |
| GitHub Copilot | Official device OAuth and saved-account reconnect; quota displayability no longer determines auth success.                           |

An optional persisted `authSource` pins Command Code/Cursor CLI versus reference
selection through observation, inference, discovery and subsequent edits. Missing
explicit references never silently choose OS auth. Absent fields preserve legacy
auto-source behavior. Changing methods cancels and settles previous device work
before applying; allocated temporary resources are tracked independently from
user-selected existing homes. Copied login commands shell-quote selected paths.

## Current focused evidence

- `pnpm --dir plugins/@dshfiles/ai-accounts test --maxWorkers=1`: **827 tests, 87 files pass**, including descendant-home cleanup protection.
- Account package typecheck and Host/login API imports pass. Restored account and shared stylesheet bundles build successfully (eight dependency tasks); the earlier credential/Secret Catalog admission graph also built successfully.
- Actual React/Query compatibility tests pass 23 cases, including choices without a credential-writing service. Scoped account lint reports zero errors and 194 advisory warnings.
- Three fresh system-Chrome journeys pass after restoration: all-provider dismissal; every restored CLI/home/reference choice with no saved entry; verified loopback Command Code plus reuse of an existing native reference and a private CLI login with persisted source pin. Non-provider configuration choices never start real sign-in or verification. No unavailable/expired warning appears after mode changes.
- Native credential-port tests and scoped Secret Catalog resolver tests cover
  capability fencing, exact scope selection and rejection before any reveal.
- Real React/Query tests reproduce stale polling undoing Claude's explicit key
  choice, then prove cancellation before newer snapshots are published.
- The exact old store from the preceding main was run against the new invariant:
  it persisted a disabled Codex draft before sign-in. The regression fails on
  that old implementation and passes with provisional preparation.
- Independent fake-clock/gated-I/O probes cover cancel-before-prepare, expiry
  during preparation, UUID casing, delayed login lookup, single reconnect-owner
  reservation and old cleanup settling before a new owner is admitted.

Seven relevant real-Chromium scenarios pass across focused runs: all six providers
with Cancel/X/Escape, synthetic Codex code-step cancellation and subprocess
termination, typed-key-only isolation, rejected provider verification, default
no-key Claude plus explicit API-key mode, preserved composer draft, exactly one
enabled saved Command Code route after successful loopback verification, existing
reconnect cancellation/completion, manual save, removal, priority and Copilot
setup. Repeated scenarios are not counted as additional coverage.

The changed SDK account seed succeeds through the actual UI on both NEW and
explicit REUSE runs, preserving the same single account/reference and reusing its
fake provider. Normal active-chat reach passes; scratch doctor passes all eight
checks (169 entries, three bundles). All owned browser/Host/fake-provider processes
were stopped. The refreshed setup screenshot contains only synthetic state; its
ephemeral private-home path is scrubbed.

The separate legacy model-effort picker journey remains unverified: its explicitly
existing fixture is enabled, has a guarded private 0600 inert auth file, and the
native picker lists nine Codex models, but the owned picker selector is absent.
This is not claimed to be a known baseline or fixed by onboarding. No real Codex
inference is attempted. Broader metadata checks still report the agents mention
preview coverage omission and traces generated-config drift; neither is changed
here. The previous admission-only scope had zero lint errors and 188 advisory warnings; the compatibility restoration also runs scoped lint before handoff. An additional
SDK scratch unit run passes 22 tests; four browser-launch cases are blocked by
unavailable bundled Chromium, while the actual system-Chrome runs above pass.
The repository screenshot check also reports missing screenshots for the
untouched user-questions and worktree-memory plugins. Do not reuse older
537-test/24-journey evidence as proof of this admission change.

## Authentication and secret boundaries

Automated checks use injected provider responses, temporary homes and synthetic
CLI output. No real OpenAI/GitHub provider consent is approved. The inert Codex
fixture is only an explicitly existing/legacy model-catalog fixture: it does not
prove a new connection or bypass admission. Live provider validity, billing,
installed CLI versions and cross-OS behavior remain unverified.

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

The strip formerly selected only accounts with an `ok` quota response and a
binding window, while the account page reported local credential presence.
An enabled account therefore disappeared when a provider rejected its quota
request even though its saved profile remained present. These are distinct
facts: credential availability is not proof that a provider accepts it now.

Visibility now follows enabled/explicit-hidden preferences, not quota status.
An unavailable summary is a typed alternative with no numeric percentage/reset
fields. The sidebar, collapsed rail, edge widget and visible usage cards keep
those accounts reachable with a reason. Unknown quota never enters numeric
critical-account ranking. Canonical account priority and session-before-weekly
window order remain unchanged; explicit hiding and active-wire attribution keep
their existing behavior. The last-good transient-error cache policy is unchanged.

Verified: 847 account tests across 88 files and typecheck pass. Fourteen actual
component cases cover rejected quota, other missing states, rail/edge neutrality,
manual hiding, active-wire highlights, mixed priority and recovery without
replacing the button identity. The exact unavailable-account component reproduction fails
against the previous components in an isolated fixture. Model regressions also
cover reserve-only data and unknown values excluded from numeric ranking. The
browser regression uses only synthetic loopback metadata; no real credential is
changed and no model request is made. Two focused system-Chrome scenarios pass:
provider quota 200→401→200 with the same saved account/reference, and existing
page/sidebar priority synchronization. The 401 path keeps the status tile and
provider reason visible, preserves mixed priority, supports explicit Hide/Show,
and recovers real quota meters without changing credentials. Rail/edge
all-unavailable behavior is covered by component tests, not that browser run.

## Minimal connection dialog and account naming

The two common methods have short labels and a visible selected state. Named
credentials, existing default Claude login and custom CLI homes remain under
**More options**; Secret Catalog import has its own disclosure. Provider safety
notes and CLI commands remain available without dominating the initial view.
The shared saved-account key editor retains its original title and actions.

New accounts have a pencil beside their name. Enter or **Save name** updates
only provisional metadata; Escape or **Cancel name edit** discards the unsent
edit. Names are trimmed and validated against the existing 1–120-character
schema. Routes, references, home paths, staged keys and active login identities
are unchanged. Existing reconnects cannot rename saved accounts. Old Hosts
that ignore this optional field leave the editor open with an error rather
than pretending success.

Verified: 897 account tests across 88 files, including 36 actual overlay cases,
plus account/dshx typechecks and rebuilt Host import checks. Host/API regressions
cover metadata-only edits, completion, cancellation, expiry and concurrent operations. Actual overlay tests cover keyboard behavior,
method switching, local key preservation and old-Host handling. Four isolated
browser journeys verify all provider cancellation paths, all supported methods,
Copilot choice without OAuth, and successful named reference/CLI accounts with
unchanged route identity after reload. Claude screenshots at 360, 480 and 1280
pixels cover subscription, inline editing and API-key layouts. No real provider
login or paid inference was used. The pending-name Host change requires a
user-managed restart; the live DSH is never restarted by verification.

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

## Signed-out Codex reconnect failure

The reconnect defect conflated a terminal verification failure with expiry
and discarded the dialog's existing-account context. Private live account and
authentication observations are omitted from this publication. The isolated
loopback regression described below is the reproducible evidence; it does not
establish any real account's authentication or quota state.

Saved Codex browser reconnects now offer **Continue with Codex** directly,
with explicit replacement consent and no automatic login. The original login
is preserved until approved sign-in and verification succeed. Failed or expired
connection attempts retain reconnect context and offer **Start again**, which
allocates a fresh operation for the same saved account instead of retrying a
permanently discarded operation. Healthy Copilot's existing-credential choice
is unchanged. The Host's verification and terminal-cleanup policy is unchanged;
rejected credentials are never treated as authenticated.

Verified: 900 account tests (88 files), including 39 actual overlay cases,
account typecheck and Host import pass. The loopback browser regression now
waits for rejected verification's terminal poll, checks future expiry and null
account, restarts with a different operation ID for the same saved profile,
compares all saved account/reference fields, cancels and recovers quota. No
provider browser login is started by opening reconnect; the typed Codex test
checks explicit replacement consent only after **Continue with Codex**.

## Successful reconnect rejected by JSON response validation

A separate response-serialization defect affected `completeAccountConnection`
and subsequent `getAccountConnection`: an otherwise completed result contained
`undefined`, violating the API **contract**. Private sign-in and quota
observations are omitted. The Host-wire regressions below reproduce the
serialization defect without establishing real provider authentication.

The reconnect merge in the account store always created an own `authSource`
property. Codex, Claude and Copilot legitimately omit that optional legacy
field, so their successful reconnect produced `authSource: undefined`. Disk
JSON silently omitted it, but the in-memory completed snapshot retained it;
the strict Host transport correctly refused the response after publication.

The store now omits the optional property when absent, preserving legacy
credential discovery semantics rather than inventing a source or weakening
JSON validation. Regressions use the supported test Host and the actual API
method schemas through its real output validator: new/reconnected completion,
poll and repeated completion are checked for all six providers. Before the fix,
Codex/Claude/Copilot failed after a real store commit; all six pass afterward.
Concurrent saved metadata and exactly-once publication are checked as well.

The UI separately treats contract, transport and unavailable completion errors
as an **unknown result**, not proof that authentication failed or that the
saved account stayed unchanged. It hides sign-in/retry controls and asks the
user to close setup and check their accounts, preventing duplicate sign-in.
Typed-error view regressions exercise the public client adapter and API guard.
Verified: 909 account tests across 88 files, including six new real Host
wire-boundary cases and three typed unknown-result overlay cases. The tests
were red before the owner/UI corrections and green afterward. The store
correction changes Host code and activates only on a user-managed restart;
verification never restarts the live DSH or repeats real OAuth.

## Activation

The setup fixes and sidebar visibility fix are integrated into local main,
preserving the independently landed network startup change and preexisting
canonical local edits. Setup integration rebuilt 23 dependency tasks and passed
827 account tests, ten credential-port tests, six scoped resolver tests,
account typecheck and affected Host/API imports. Host changes require a
user-managed restart; this work never restarts the running instance.

Sidebar integration separately rebuilt eight canonical dependency tasks and
passed 847 account tests and typecheck. The Host bundle's SHA-256 is unchanged;
only the account client changed (the rebuilt shared stylesheet is byte-identical).
Private live account identities, quota/authentication observations and
per-account delivery checks are omitted from the public receipt. They are not
relabeled as synthetic proof. The isolated component and loopback browser checks
above establish the visibility behavior; they do not certify a current live
account, profile, provider authorization or automatic HMR delivery.

Sidebar repair does not replace credentials or establish why authorization
failed. Real provider sign-in and setup-token endpoint permissions remain
unverified. Previously saved incomplete profiles are not automatically removed.
