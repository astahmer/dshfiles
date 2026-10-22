# Shared account pool plan

Status: **research complete; implementation not approved or started**. Evidence checked 2026-10-22.

**Resume here:** review the recommendation and percentage semantics below, then approve a bounded compatibility/accounting spike. Do not install a gateway, transfer credentials, expose a service, or change the live profile from this plan alone.

| Milestone | Status | Evidence / next gate |
| --- | --- | --- |
| GitHub and marketplace research | Complete | Five candidates; implementation and license evidence below |
| Existing AI Accounts and installed DSH contracts | Complete, static inspection | Supported opt-in provider seam exists; no universal external-runtime coverage |
| Product scope | Confirmed | All existing providers; account contributions plus per-user caps; small trusted group |
| Percentage semantics and architecture | Proposed | Native subscription percentages are not interchangeable with money/token budgets |
| Provider permission and wire compatibility | Not run | Required before enabling any shared upstream |
| Implementation, deployment, real two-device verification | Not started | Requires approval; no credentials or live services touched |

## Context

The user wants a pool of accounts usable by several people and devices, with control over both how much each account contributes and how much each person may consume. They explicitly chose all existing AI Accounts providers, contribution percentages plus user caps, and a small trusted group. They subsequently went away and asked us to continue independently; this did not authorize implementation or deployment beyond the requested investigation and plan.

AI Accounts already owns account configuration, local credential resolution, provider routes, quota displays, local distribution and recovery. It does not own shared-user identity or distributed quota enforcement:

- [Account kinds and configuration](<../plugins/@dshfiles/ai-accounts/src/api.ts#L19-L207>) cover Codex, Claude, OpenCode Go, Command Code, GitHub Copilot and Cursor. Native-provider rows are also visible, but visibility does not mean AI Accounts owns their inference.
- [Local pool state](<../plugins/@dshfiles/ai-accounts/src/account-pool.ts#L87-L119>) is process-local maps. Balanced mode weights idle age; it is neither a capacity percentage nor a per-user allowance.
- [Quota cards](<../plugins/@dshfiles/ai-accounts/src/api.ts#L188-L207>) contain percent remaining and reset times, not a common spendable denominator or per-member usage ledger.
- [Codex quota reading](<../plugins/@dshfiles/ai-accounts/src/usage.ts#L26-L56>) observes aggregate account windows. It cannot attribute concurrent private/shared usage to members.
- [Command Code endpoint validation](<../plugins/@dshfiles/ai-accounts/src/api.ts#L48-L53>) deliberately limits destinations. Do not weaken this allowlist or repurpose a local endpoint to forward existing credentials to a broker.
- [Current manifest](<../plugins/@dshfiles/ai-accounts/package.json#L61-L128>) targets DSH 0.2.1-rc.2. Read-only installed-package inspection found DSH/LLM 0.2.1-rc.2, Cordis 4.0.5 and pi-ai 1.3.0. Source catalog Cordis is 4.0.4; a scratch test must use the actual runtime combination rather than assuming compatibility.

### GitHub comparison

These are source/documentation findings, not deployments we tested. Source was inspected on current main; release dates are activity signals, not proof that every main-branch behavior exists in that release. No project below was found to implement the full requested combination of all DSH providers, native account-capacity contribution percentages and per-user entitlements.

| Candidate | What is actually relevant | Percentage / enforcement limitation | Disposition |
| --- | --- | --- | --- |
| [DSH Codex Shared Pool](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool) | Closest DSH-specific feature: team membership, invitations, contributor authorization, credential broker, durable usage and weekly sharing budgets. [MIT](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool/blob/main/LICENSE). | Codex only. [Manifest](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool/blob/98d3edcaf274934a3cb526de3c0fdaad45c0b6ef/package.json) pins DSH 0.1.2-rc.1 / Cordis 4.0.2, not our baseline. [Credits implementation](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool/blob/98d3edcaf274934a3cb526de3c0fdaad45c0b6ef/src/team/credits.ts) explicitly says weighted tokens are not subscription percent; admission reservations are estimates and final usage may exceed them. Default third-party cloud adds an unacceptable implicit trust decision. | Do not install as-is. Useful MIT reference for narrowly porting a proven broker/client mechanism only if needed; retain provenance. Not a replacement for all AI Accounts. |
| [sub2api](https://github.com/Wei-Shaw/sub2api) | Most complete subscription-oriented gateway: account pool, OAuth/API credentials, users, device keys, user/group concurrency, user/platform budgets, daily/weekly/monthly spend windows. [Auth source](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/server/middleware/api_key_auth.go). [LGPL-3.0 license text](https://github.com/Wei-Shaw/sub2api/blob/main/LICENSE); README says or-later. [v0.2.17](https://github.com/Wei-Shaw/sub2api/releases/tag/v0.2.17), 2026-10-16. | Money caps are not provider-capacity %. Ordinary accrued-use checks can overshoot while requests are in flight; [billing source](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/billing_cache_service.go) also permits some quota/RPM checks on Redis/DB errors. Prove or replace those paths before claiming fail-closed enforcement. Simple mode skips billing by default; its optional key-window limits are documented soft caps. No proven support for every owned DSH provider. | Best subscription-oriented comparison/spike candidate, only for contractually permitted upstreams. Use standard mode if testing enforcement. Do not port its whole platform. |
| [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI) | Lightweight multi-account OAuth/API and protocol bridge; caller keys separate from upstream credentials. [MIT](https://github.com/router-for-me/CLIProxyAPI/blob/main/LICENSE). [v8.0.39](https://github.com/router-for-me/CLIProxyAPI/releases/tag/v8.0.39), 2026-10-22. | [Configuration](https://github.com/router-for-me/CLIProxyAPI/blob/main/config.example.yaml) weights upstream credential selection, not user capacity. [Built-in caller auth](https://github.com/router-for-me/CLIProxyAPI/blob/main/internal/access/config_access/provider.go) checks key membership, not per-user budget. This is not a complete allocation service. | Optional execution bridge if a required permitted protocol cannot be served otherwise. Never treat weights as the requested contribution cap. |
| [New API](https://github.com/QuantumNous/new-api) | Broad API/team gateway with user wallets, key quotas, reserve/settle/refund accounting and subscription funding. Current source also has [Codex OAuth support](https://github.com/QuantumNous/new-api/blob/main/service/codex_oauth.go); not API-key-only. [AGPL-3.0](https://github.com/QuantumNous/new-api/blob/main/LICENSE) plus [attribution notice](https://github.com/QuantumNous/new-api/blob/main/NOTICE). [v1.0.0-rc.46](https://github.com/QuantumNous/new-api/releases/tag/v1.0.0-rc.46), 2026-10-21. | [Billing implementation](https://github.com/QuantumNous/new-api/blob/main/service/billing_session.go) has estimated pre-consumption, optional trust bypass and possible settlement debt. No native percentage-of-provider-capacity allocation. Protocol conversion is not proof of complete tool/reasoning/image parity. | Preferred first reuse candidate for an authorized API-account pilot. Disable incompatible trust/fallback behavior or reject it if the accounting contract cannot be proven. |
| [Claude Relay Service](https://github.com/Wei-Shaw/claude-relay-service) | Multi-account service with per-key monetary/token/request caps; [MIT](https://github.com/Wei-Shaw/claude-relay-service/blob/main/LICENSE), Node + Redis. [Enforcement middleware](https://github.com/Wei-Shaw/claude-relay-service/blob/main/src/middleware/auth.js). [v1.1.315](https://github.com/Wei-Shaw/claude-relay-service/releases/tag/v1.1.315), 2026-09-10. | Per-key caps do not automatically aggregate one person's multiple devices. No capacity %. Upstream warns versions <=1.1.248 had admin-auth bypass and points greenfield users toward sub2api. | Do not adopt for this greenfield feature. Retain only as a comparison. |

Operational costs are self-hosting, storage/backups, upgrades and actual provider charges; open-source licensing is not free inference or permission to redistribute subscription access. No commercial managed plan/pricing or vendor security guarantee was verified. Prefer official prebuilt release artifacts or trusted binary caches for any approved spike; do not silently start source builds.

### Provider permission and capability inventory

“All providers” is the product target, not a claim that every account may safely or contractually enter one shared pool. A plugin can display an unsupported provider without pretending to share it. Unknown permission means sharing disabled, not enabled with a disclaimer.

| Provider / surface | Current technical evidence | Shared-group status / next gate |
| --- | --- | --- |
| Codex subscription | Native Codex transport, account-scoped OAuth, aggregate 5-hour/weekly/additional windows. Generic opaque broker keys cannot simply replace native OAuth. | OpenAI's indexed official [terms](https://openai.com/policies/row-terms-of-use/) prohibit making an account available to others; official [sharing policy](https://help.openai.com/en/articles/10471989-openai-account-sharing-policy) distinguishes one owner using multiple devices. Full-page fetch returned 403, so recheck applicable agreement before approval. Do not enable consumer-account sharing for this group without applicable authorization. |
| Claude subscription | [Claude account implementation](<../plugins/@dshfiles/ai-accounts/src/claude-account.ts#L21-L33>) preserves local CLI-owned login; some inference uses the unmodified CLI. [Quota dispatch](<../plugins/@dshfiles/ai-accounts/src/account-usage.ts#L36-L37>) always reads subscriber-login quota, even when inference uses a separate setup-token/API-key Messages route. Never use that subscription card to represent API spend; an authorized API variant needs independent route identity, budget and billing source. | Official [authentication and credential-use policy](https://code.claude.com/docs/en/legal-and-compliance.md) explicitly forbids third-party routing through Free/Pro/Max credentials on users' behalf and intermediating Claude.ai credentials. Do not implement that group-sharing mode. Authorized API-key use is a separate track, not a loophole. |
| OpenCode Go | [Quota parser](<../plugins/@dshfiles/ai-accounts/src/usage.ts#L127-L163>) observes rolling/weekly/monthly percentages; existing keyed route is technically distinct from a group API contract. | [Terms](https://opencode.ai/legal/terms-of-service) restrict use to own internal purposes, not third parties, and prohibit multi-account limit circumvention. Require provider-approved group/API arrangement; otherwise keep local only. |
| Command Code | [Quota source](<../plugins/@dshfiles/ai-accounts/src/commandcode-usage.ts#L62-L108>) has used/cap/reset fields and monthly/purchased/free credits; displayed monthly percentage is derived using a plan-allowance table, not an authoritative per-request debit. Preserve plan-specific CLI/OpenAI/Anthropic transport selection rather than assuming every account speaks OpenAI. | [Terms](https://commandcode.ai/terms), updated 2026-10-20, restrict transfer/time-sharing/service-bureau use and one-account-per-person limit circumvention. Do not pool personal subscriptions for others absent applicable permission. Numeric credits do not imply redistribution rights. |
| GitHub Copilot | Account-specific OAuth; [quota reader](<../plugins/@dshfiles/ai-accounts/src/copilot-quota.ts#L6-L24>) explicitly uses undocumented best-effort snapshots. Unlimited meters are not finite share denominators. | [GitHub account terms](https://docs.github.com/en/site-policy/github-terms/github-terms-of-service#3-account-requirements) say a personal login cannot be shared by multiple people. Use individual authorized seats; inspect Copilot-specific terms and supported transport before proposing any organizational pooled allowance. |
| Cursor | [Current account module](<../plugins/@dshfiles/ai-accounts/src/cursor-account.ts#L13-L25>) exposes identity/quota, no model route. It points to a separate runtime driver, whose actual mounted availability was not established here. | Not remotely poolable through the LLM adapter alone. Remain observation-only until a supported driver contract, provider authorization and attribution/enforcement path are proven. Do not forward filesystem/shell/runtime-control access as if it were an inference gateway. |
| Native provider rows / other API accounts | AI Accounts can show/toggle native rows without owning their request transport. | Inventory each installed provider separately. Organization-authorized API keys are the most practical initial shared capacity, subject to the applicable provider contract. No universal API-key permission claim. |

Policy findings are product constraints, not legal advice. A private network, trusted friends, a proxy, or concealed refresh tokens does not change provider authorization. No credential-camouflage, fingerprint evasion or quota-circumvention work is included.

## Goal

Let authorized members use permitted shared inference capacity from multiple devices, with centrally enforced account-contribution limits and aggregate per-user caps, while retaining existing AI Accounts local behavior.

The exact original target remains unmet for providers lacking permission, routable APIs or attributable capacity units. Do not silently narrow “all providers” to a gateway's marketing provider list or relabel estimated budgets as exact subscription percentages.

## What

1. Extend AI Accounts with an opt-in **Shared pools** section, connections, contributor settings and broker-derived allowance/status views. Keep the account editor and local mode in their current owner.
2. Deploy a separate headless **account-pool service** for the small group. It owns membership, per-device credentials, upstream credential custody, eligibility, admissions and one durable accounting ledger.
3. Reuse an existing gateway where it passes the required protocol and accounting contract. Start evaluation with New API for authorized API accounts; compare sub2api for permitted native/subscription transports. Do not run both by default or embed either platform in DSH.
4. Add the missing contribution/user-percentage policy at the authoritative server boundary. If a gateway can own the full ledger, extend it narrowly. If it cannot, use it only as a private execution bridge behind a single policy-ledger owner. Do not maintain two competing authoritative balances.
5. Represent every existing provider with an explicit support/permission status. Enable only measured, authorized paths. Keep unsupported or prohibited paths local/observation-only and leave their roadmap gates visible.

This is **extend existing + adopt server-side components conditionally**, not a second competing AI Accounts UI and not a DSH core patch. A new DSH client plugin is justified only if a separately reusable transport/lifecycle emerges from real callers.

## Why

Independent device-local pools cannot agree on usage or protect contributions under concurrent requests. Synchronizing credentials increases exposure and refresh-token races; synchronizing counters does not create atomic enforcement. Per-device keys without a stable member identity let one user multiply their allowance.

## How

### Conceptual model: percentages must have named denominators

Two different percentages are required:

- **Account contribution:** how much of account A's eligible capacity may serve other members.
- **Member allowance:** how much of the shared budget member U may consume across all their devices.

Do not confuse either with account-routing weights, request counts, advertised plan prices, dollar-equivalent token estimates, or current percent remaining.

For a resource bucket `k` with an explicit unit and reset policy:

```text
B[a,k] = account a's configured or authoritative total capacity for bucket k
C[a,k] = floor(B[a,k] * accountContributionBasisPoints[a] / 10_000)
P[k]   = sum(C[a,k]) over active, permitted, compatible contributors
L[u,k] = floor(P[k] * memberShareBasisPoints[u,k] / 10_000)
```

Example: two compatible accounts have configured monthly budgets of 100 and 200 units. Each contributes 30%, so shared capacity is 30 + 60 = 90 units. Alice's 60% and Bob's 40% shares are caps of 54 and 36 units. This is **percentage of the configured budget**, not a claim that 90 units equals 30% of a provider subscription.

Rules:

1. Store percentages as integer basis points in `[0, 10_000]`. Sum member entitlements must be <=100% within each bucket; leftover is unallocated, not silently borrowed. Distinguish “user hard cap” from any future scheduler weight.
2. Keep incompatible resources separate: provider/account quota family, model class, unit and window. Never sum arbitrary remaining percentages or add two windows for the same underlying allowance. Optional cross-provider totals require an explicitly versioned common internal unit and stay labeled estimates.
3. For measurable API budgets, contribution and user caps can be enforced in local money/token/credit units. Monetary calculations use integer smallest units and a versioned rate card, including cached input, reasoning/output and additional metered features.
4. For native subscription percentages, aggregated polling is insufficient for exact pre-request attribution, especially with concurrent or out-of-broker use. A serialized before/after delta is still rounded/delayed observational evidence, not a guaranteed price. Mark such a guard **best effort**, never “hard 30%”.
5. An exact native-capacity mode requires an authoritative finite denominator and attributable consumption, or a provable conservative bound for each admitted request. Unknown/unlimited denominators do not become zero, 100% or infinity in arithmetic. Disable exact mode for that bucket when the contract is unavailable.
6. A contributor's local use can consume their supposedly private reserve. A “70% private” guarantee requires all relevant consumption, including the owner's, to pass through the same enforcement boundary; otherwise the service can only cap broker-observed shared use and report external drift. Provider availability is never guaranteed.
7. Snapshot membership/capacity/allocation versions at each budget epoch. Additions/increases take effect next epoch by default; removal/revocation stops new admissions immediately. Decreases retain spent/reserved charges and can leave a member over their new cap; never erase debt or replenish by editing percentages.
8. Preserve each account's real provider reset boundary; do not align all weekly windows by guessing. Locally configured calendar budgets default to UTC with the next reset explicitly shown. Rolling windows use sliding accounting, not a midnight reset. No automatic rollover or unused-share borrowing in the first version.
9. Owner private and contributor shared charges are classified separately but any owner request explicitly using shared capacity consumes their member entitlement. Multiple groups sharing one account must use the same account-level limit or are unsupported initially; duplicate contribution registrations must not double-count capacity.

**Approval boundary:** an implementable first version offers hard broker-budget accounting where usage bounds permit it and clearly labeled best-effort native quota guards. This is not equivalent to the requested exact native subscription-% behavior. If exactness for every subscription is mandatory, stop at the permission/metering gaps rather than ship a misleading slider.

### Operations / behavior

1. Owner creates a private pool and invites named members. Contributor grants access to an allowed upstream explicitly; existing local logins are never silently uploaded or enrolled.
2. Each member enrolls each device separately. Broker maps an opaque, revocable device credential to the member and pool. Caller-provided member/session/account IDs are labels, not authentication.
3. Broker validates model/account access, provider permission, health, quota freshness and applicable account/member/pool limits before selecting an account. Affinity and cache locality influence selection only after eligibility.
4. Admission atomically reserves against all applicable buckets. A durable request ID and attempt ID distinguish transport reconnects, retries and genuinely new upstream work. Bind idempotency keys to authenticated principal and a request fingerprint.
5. Stream from the chosen upstream, preserve cancellation/backpressure, then settle actual attributable usage once. Reconnects and duplicate completion events must not double-charge; a separate retry that consumes upstream resources must not be made free by reusing an admission ID.
6. Do not replay partially emitted outputs blindly on account failover. A tool call or provider-side operation may already have occurred. Fail explicitly or resume only when the protocol proves safety.
7. Bound maximum output/feature cost when a hard budget is promised. Estimated reservations without a proven bound allow overshoot: advertise an explicit bounded tolerance or deny hard-cap mode. A fixed small reservation is not proof of a hard limit.
8. Cancellation or timeout does not imply zero provider usage. Keep unresolved reservations pending for bounded reconciliation; do not automatically refund after disconnect, lease expiry or a crash while upstream work may continue. A confirmed unsubmitted request may release its hold.
9. On ledger outage, revoked access, exhausted share or unknown required usage, fail closed for pooled inference. Do not silently fall back to another person's account, the contributor's private reserve, a wallet balance or the user's local accounts. Local mode remains manually selectable.
10. Shared user caps span every device, retry, subagent and background/title/compaction call sent to that pooled route. Explain exhaustion reason and next reset separately from upstream rate limits. Local recovery logic must not rotate around a member-budget denial.

### Tech choices

| Choice | Proposed decision | Rationale |
| --- | --- | --- |
| DSH ownership | Extend AI Accounts, explicit pooled routes | Avoid duplicate editors, routing owners and quota displays; preserve defaults |
| Enforcement owner | Dedicated headless server, one authoritative ledger | Multiple devices cannot enforce shared caps independently |
| Gateway reuse | Evaluate New API first for permitted APIs; sub2api second for specific permitted transports | Real user-level accounting exists; neither fully meets contribution-% semantics |
| Bridge | CLIProxyAPI only if a demonstrated protocol gap requires it | Avoid adding an extra credential-holding hop by default |
| Persistence | Transactional relational storage; PostgreSQL preferred for production multi-device service | Atomic multi-bucket admission, durable reconciliation, restore tests; reuse adopted gateway's supported store where suitable |
| Secrets | Upstream secrets only at operator-controlled execution boundary; clients store `secret:ALIAS` device-credential references | Do not copy upstream refresh tokens to members or browsers |
| Network | Self-hosted private endpoint, HTTPS; management isolated from inference | A private mesh alone does not authenticate members or authorize requests |
| Rollout | Disabled by default, no cloud endpoint preselected | Explicit trust and opt-in; local account behavior unchanged |
| Initial allocation | Strict caps, no borrowing, policy-versioned epochs | Predictable behavior before adding weighted fair scheduling |

### Architecture

```text
DSH device A                          DSH device B
AI Accounts                          AI Accounts
  connection metadata                  connection metadata
  secret:DEVICE_A ref                   secret:DEVICE_B ref
          |                                     |
          +------- HTTPS pooled inference ------+
                              |
                  account-pool service
             device -> member -> pool authorization
             account contribution + member cap policy
             atomic reserve / settle / reconciliation
                        one durable ledger
                              |
                   private execution boundary
             adopted gateway or provider-specific adapter
                   encrypted upstream credentials
                              |
                  permitted provider endpoints
```

The operator/execution boundary sees prompts, attachments and outputs in transit. Credential secrecy from other members is not end-to-end secrecy from the operator. Default to no prompt/response persistence; opt-in diagnostics require redaction, retention and informed consent. Members see their own usage and aggregate availability, not other members' prompts or contributor identities/email unless explicitly authorized.

### Supported DSH integration boundary

Installed DSH 0.2.1-rc.2 exposes `LlmAdapter`, `ctx.llm.registerAdapter`, model resolution/catalogs and generation-bound `prepareCall`. Its pi-ai provider profiles support `api`, `baseURL`, `models`, `headers` and `apiKeyEnv`. These are enough for opt-in broker-owned routes; an initial compatible gateway spike may need no custom transport beyond configuration.

Prefer the stock provider profile when it preserves the complete required protocol. Otherwise implement the smallest adapter in AI Accounts, with proper request attribution headers, abort propagation, finish/error chunks, capability metadata and generation-consistent preparation. Publish cross-plugin contracts through declared dshx modules only if a real second caller needs them.

Do not substitute an opaque pool key into the existing native Codex provider: installed pi-ai decodes account claims from OAuth before networking and sets upstream auth headers itself. The device should speak the broker's permitted client protocol; native upstream credentials stay server-side. Never mint fake account JWTs.

A public `llm/stream` waterfall exists, but covert all-route interception would add normalization/replay/error ownership and is not needed for opt-in pool routes. `agent/request` alone misses auxiliary LLM calls. Model preparation still needs a registered adapter. Calls outside the LLM service, including external runtime drivers, remain separate boundaries.

Installed `GenerateOptions` has session/purpose/provider/model but no authenticated human/device billing principal. The service must authenticate the per-device pool credential and aggregate under its server-owned member ID. Several browsers connected to one DSH Host do not thereby receive separate quota identities; require independently scoped Host/profile connection configurations with one member's broker credentials each, or prove a supported per-session credential/principal binding. Separate browser connections alone do not solve this; stop at the missing identity boundary if neither approach is available. Never infer identity from browser display name or session ID.

No DSH core patch is proposed. If the approved design later requires a capability absent from supported APIs, record the exact gap in the [Host gap ledger](<dsh-host-gaps.md>) and stop that branch. Existing absence of universal runtime-driver attribution does not block an honestly scoped opt-in LLM route.

## What this allows

- One authorized member's allowance shared across their devices, with independent device revocation.
- Multiple permitted contributors with explicit, non-overlapping shared budgets and protected server-observed private/shared classifications.
- Central enforcement, durable usage, clear reset/exhaustion reasons and audit of settings changes.
- Same AI Accounts entry point and matching read/write agent tools, without giving agents the upstream credentials.

## What this does not allow

- A claim of exact subscription capacity from token-price estimates or routing weights.
- Sharing forbidden personal subscriptions, bypassing plan limits or treating a checkbox as provider permission.
- Arbitrary command execution, filesystem access or whole DSH remote control through an inference pool.
- Undisclosed default cloud, peer-to-peer OAuth copying, contributor-device federation or multi-region active-active in the first version.
- Guaranteed capacity when a contributor consumes allowance outside the service or upstream changes/revokes it.
- “All providers supported” while Cursor is observation-only, a runtime driver bypasses accounting, or a policy gate remains closed.

## UI & UX

### Desktop

Add **Shared pools** inside AI Accounts, not a duplicate accounts application:

```text
Local accounts | Shared pools

Pool: Friends                 Connected as: Alice
Member allowance: 54 units    Used: 12  Reserved: 3  Available: 39
Basis: configured API budget  Resets: <exact time and zone>

Contributions (authorized owners/admins)
Account      Contribution     Meter basis       Sharing status
API A        30%              monthly units    Ready
Codex        —                subscription     Permission required
Cursor       —                observed quota   No supported pool transport

Members: allocation %, spent, pending, reset  [owner only]
Devices: mine, last used, revoke              [member]
```

Show provider remaining quota and member remaining budget separately; never merge the bars. Expose the denominator, window, stale/estimated status and applicable model constraints beside every percentage. Unsupported controls explain the actual gate instead of accepting a nonfunctional setting.

### Mobile

Stack allowance and connection status first; collapse contributor/admin sections. Keep device revocation confirmations and percentage denominators readable. No separate mobile domain state or browser-local balance arithmetic.

### Common interactions

| Action | Result |
| --- | --- |
| Connect | Validate an explicit endpoint and device reference; show operator/trust identity before sending work |
| Change contribution/share | Show effective date and current spent/pending impact; validate server-side and audit once |
| Revoke device/member | Explicit confirmation; stop new admissions immediately and cancel in-flight work where supported; pending usage still reconciles |
| Exhaust member budget | Specific member-limit error and reset; no automatic local/upstream-account escape |
| Disconnect | Stop using pool for new requests; preserve local account configuration; settle already submitted requests |
| Request agent action | Same permission-checked Host operation as UI; read-only summaries redact all credential material |

UI/agent writes are owner/member scoped. Agent access does not imply pool-admin authority. Credential reference grammar/resolution comes from the existing [credential contract](<../docs/secret-references.md>); never echo credential values into settings, tool results or logs. Client async state uses the project's Query/Form/machine bindings when implementation is approved.

## Data model

Keep types domain-local and boundary schemas validated once. The existing local account file remains local configuration, not a distributed database.

| Entity | Important fields / invariants |
| --- | --- |
| Pool | ID, operator, status, allocation version; one authoritative enforcement owner |
| Member | Pool/user ID, role, status; stable identity independent of device keys |
| DeviceCredential | Member ID, key ID, verifier/hash, scopes, expiry, revokedAt; plaintext issued only through explicit out-of-browser enrollment into member Host secret storage; DSH receives/stores a reference, never echoes the key |
| UpstreamAccount | Provider, opaque owner, credential reference, policy eligibility, health; refresh ownership serialized |
| Contribution | Account/pool, contribution basis points, effective epoch, enabled; account-level ceiling prevents duplicate-pool contribution |
| ResourceBucket | Unit, provider/model quota family, capacity basis, window/reset policy, source freshness, enforcement strength |
| AllocationEpoch | Immutable capacity/contribution/member-share snapshot; budget edits cannot recreate spent capacity |
| Reservation | Principal, bucket charges, attempt/request IDs, fingerprint, deadline, pending/settled/reconciliation state |
| UsageLedgerEntry | Immutable debit/credit/adjustment, unique settlement ID, resource and pricing versions; no prompt/response content |
| QuotaObservation | Aggregate provider signal/time/confidence; explicitly not authoritative per-user consumption |
| AuditEvent | Actor, action, target IDs, policy version, correlation ID, bounded/redacted outcome |

Identity, upstream refresh tokens and inference payloads have different retention/access rules. Encrypt upstream credentials with keys outside the database; separate management from execution access. Budget state is server-owned; browser caches and local displays are not another ledger. Backups must preserve both accounting consistency and the required encryption-key recovery path.

## Implementation steps

Implementation starts only after approval; no checkbox below is a shipped capability.

1. **Freeze semantics and provider eligibility.** Confirm whether configured-budget percentages plus labeled best-effort quota guards are acceptable. Build a per-provider/account-plan permission and metering matrix. If every native subscription must support exact %, record that unmet requirement rather than weakening it silently.
2. **Run a disposable compatibility/accounting spike.** Pin candidate versions/artifacts, review license/provenance/security notes, and compare New API against sub2api only on permitted test accounts. Verify user-level aggregation and protocol semantics, not an HTTP 200 or install success. Prove no hidden payload retention, credential-export path or quota bypass. No real credential transfer without explicit authorization.
3. **Choose one ledger owner.** Reuse the gateway's existing admission/settlement store if it can express account contributions and aggregate members correctly. Otherwise keep the gateway private as an execution bridge behind a minimal pool-policy service. Record why missing behavior cannot be configured before writing custom code. Do not sync a second mutable balance into DSH.
4. **Implement server policy and recovery first.** Transactional multi-bucket reservations, idempotency, finite/unknown usage policy, reset/epoch rules, account refresh serialization, revocation, retry/cancel settlement and crash reconciliation. Reject arithmetic over unknown/unlimited capacity. Test real storage/concurrent workers rather than mocking away transactions.
5. **Integrate AI Accounts transport.** Add an explicit remote-pool connection model, credential reference and broker-owned routes; prefer existing pi-ai profiles where sufficient. Preserve local-mode schemas/defaults and endpoint restrictions. Cover titles, compaction, subagents and fast/background features on pooled routes, not just visible main-chat calls.
6. **Add UI and agent parity.** Connections, contribution/share editor, member/device administration, separate budget/quota views and failure reasons. Server authorization controls every operation. Use existing UI/state patterns; version the narrow API and tolerate old Host snapshots until restart.
7. **Expand provider by provider.** Do not enable restricted consumer plans. Require native capability and attribution evidence for each permitted adapter. Cursor/external-runtime support needs its own supported driver contract; document gaps without core patches. Keep final “all providers” milestone open until every requested provider has an honest supported route or the user accepts exclusions.
8. **Prove actual multi-device behavior.** Two member identities, at least two physical devices and concurrent requests through the same service; verify caps, revocation, restart/recovery and no bypass. Then run scratch DSH UI/tool journeys, screenshots and focused tests/lint/typecheck/format. Record real wire proof separately from unit tests.
9. **Deploy only by opt-in.** Choose the server host/network and approved credentials, back up the ledger/key material, document operator trust and rollback. Keep :3080 untouched. New Host code/profile composition needs a user-controlled DSH Host restart; client-only changes follow the actual build/HMR rules. Disabling the feature must preserve local accounts and pending ledger entries.

## Open questions

No additional questions were sent after the user went away. These are future approval gates, not assumptions silently marked agreed:

1. **Native-% exactness:** are explicit configured-budget shares with best-effort native quota guards acceptable, or is exact provider subscription capacity mandatory? Default proposal is honest budget shares; it does not satisfy the stricter interpretation.
2. **Provider authorization:** which actual plans/contracts permit this trusted group's shared use? Default is restricted/unknown disabled. The requested “all existing providers” remains a target, not blanket permission.
3. **Deployment/trust:** which operator-controlled host should hold shared upstream credentials, and may those credentials be transferred there? No transfer or third-party cloud was approved.
4. **Per-bucket values:** actual contributors, contribution %, member caps and chosen reset windows are not provided. Do not configure accounts from example numbers.
5. **Disconnected contributors:** initial design is central custody with explicit consent; keeping credentials on contributors' machines requires a later outbound-worker design, freshness rules and availability trade-offs.

Defaults proposed without blocking research: self-hosted private endpoint, HTTPS, per-device revocation, no borrowing/rollover, UTC for local calendar budgets, no body logging, no silent local fallback and no changes to existing local routes.

## Acceptance criteria

### Research and plan delivery

- [x] Compare real GitHub projects and inspect high-impact source/license claims.
- [x] Inspect current AI Accounts and installed public DSH extension contracts.
- [x] Record user-confirmed scope separately from proposed defaults.
- [x] State exact-%/all-provider gaps, provider restrictions, security boundaries and implementation gates.
- [x] Make no implementation, credential, deployment or live-profile changes.

### Future implementation acceptance

- [ ] Allowed accounts have explicit contribution bounds; each member's cap aggregates every enrolled device and pooled call purpose.
- [ ] Two simultaneous devices cannot admit beyond the defined reserved budget; partial/cancelled/late/duplicate results reconcile once under the documented usage bounds.
- [ ] A 30% account contribution and 60/40 member split produce the declared unit-based limits; zero, 100%, over-allocation, rounding and unknown/unlimited cases are covered.
- [ ] Multi-window/model limits are independently enforced; quota resets, staggered contributor resets, manual upstream resets and policy edits never recreate spent allowance.
- [ ] Retries/failover/reconnects neither escape caps nor double-charge the same completed attempt; tool side effects are not blindly replayed.
- [ ] Permission, authentication, member isolation, device revocation and endpoint validation have positive and negative tests.
- [ ] No OAuth/key/cookie values appear in browser state, settings, agent output, logs or checked-in fixtures; inference-body logging is off and verified across dependencies/proxies.
- [ ] Pooled-route main/subagent/title/compaction/tool/image/reasoning/Fast paths pass applicable wire tests; unsupported features are not advertised. Native/external-driver bypass paths are named and constrained.
- [ ] Exact native quota % is advertised only where authoritative measurement and safe admission bounds were actually proven; estimates remain labeled.
- [ ] Every requested provider has a permitted, verified route or an explicitly accepted exclusion; no false “all providers” completion.
- [ ] Real cross-device verification, ledger restart/crash recovery, backup restore, scratch DSH UI and agent-tool journeys pass.
- [ ] Existing local accounts/defaults are unchanged with sharing disabled; no live DSH restart or deployment occurs without authorization.

## Decisions log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-10-22 | User: all existing AI Accounts providers | Preserve as target; do not silently substitute a gateway's supported list |
| 2026-10-22 | User: account contribution percentages plus per-user caps | Two independent policies, not a routing-weight option |
| 2026-10-22 | User: small trusted group | Separate member identities and revocable device credentials; no payment/SaaS platform needed |
| 2026-10-22 | User away: continue research/plan independently | Do not block on more questions or expand into unapproved implementation |
| 2026-10-22 | Proposed: extend AI Accounts; headless centralized service | Existing UI/routing owner retained; cross-device enforcement needs a server |
| 2026-10-22 | Proposed: reuse gateway conditionally, one ledger owner | Existing projects solve protocol and user accounting, not exact requested native-% semantics |
| 2026-10-22 | Restricted/unknown providers remain disabled for group sharing | Technical credential access does not grant redistribution permission |
| 2026-10-22 | No implementation/deployment in this task | User explicitly asked investigation first, then a plan |

## Evidence and verification limits

Verified here: public source/license fetches, current workspace source and installed declaration inspection. The marketplace Codex pool reference was inspected at commit `98d3edcaf274934a3cb526de3c0fdaad45c0b6ef`. Its [compatibility report](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool/blob/98d3edcaf274934a3cb526de3c0fdaad45c0b6ef/docs/compatibility/dsh-0.1.2-rc.1.md) and [README](https://github.com/502399493zjw-lgtm/dsh-codex-shared-pool/blob/98d3edcaf274934a3cb526de3c0fdaad45c0b6ef/README.md) distinguish older same-machine acceptance from real cross-network/device proof.

Installed public contracts inspected: `@deepseek-ai/dsh-llm@0.2.1-rc.2/lib/types/index.d.ts` lines 28–45, 124–196 and 255–262; `types.d.ts` lines 506–548; `@deepseek-ai/dsh-llm-pi-ai@0.2.1-rc.2/lib/types/config.d.ts` lines 54–114. Installed pi-ai native Codex source was also inspected to establish the OAuth-versus-opaque-key distinction. Package export resolution was checked under ESM import conditions; an initial CJS-condition lookup failure was an inspection artifact, not an established incompatibility.

Unverified: candidate software boot/runtime behavior, actual provider permission for the group's accounts, exact native quota attribution, feature parity under real calls, per-provider support across all current routes, production security, and real multi-device/network operation. No candidate was installed, no login or private prompt history was read, and no upstream requests were sent. OpenAI policy full-page fetches returned 403; indexed official policy text is lower-strength evidence and needs direct agreement review before activation.
