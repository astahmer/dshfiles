# Serving-account verification

## Boundary and prerequisites

AI Accounts already owns the request pool, adapters and quota surfaces. Attribution
extends that owner, not routing priority or authentication. `agent/request` selects
a main step; `llm/stream` observes its actual routed account. A usage chunk plus a
non-error terminal finish records success. Failed, cancelled/truncated and
superseded requests cannot replace the last success. Native/unknown requests
forget it. Nothing adds a synthetic Session event.

The public DSH 0.2.1-rc.2 slot `PropsRuntime<'main'>['useSessions']` supplies the
foreground retained Session. The client injects `sessions` and passes that native
hook unchanged into a Query-provider child. Queries include Session/running state,
forward cancellation, validate nested Session IDs and never keep previous-chat
placeholder data. Missing/older Hosts fail closed. `ApiCaller` comes from dshx;
transport-owned caller identity—not input JSON—enforces agent self-only reads.
No restated native interfaces, SDK patch or core prerequisite is required.

The `ai_accounts_serving` storage domain keeps only successful routing metadata,
pruned to 2,000 Sessions/90 days on open and successful writes. Current attempts
stay in memory and are cleared when a turn/Agent ends. Storage failure is not an
inference failure. Existing provider-request tracing/adapters remain unchanged.

## Focused commands

Run from this checkout with its locked dependencies, on the repository's pinned
Node. Build the dependency graph first in a fresh worktree:

```sh
pnpm install --frozen-lockfile
pnpm exec turbo run build --filter=@dshfiles/ai-accounts^...
pnpm --dir plugins/@dshfiles/ai-accounts typecheck
pnpm --dir plugins/@dshfiles/ai-accounts exec vitest run src/serving-account.test.ts src/serving-account-host.test.ts src/use-serving-account.test.ts --maxWorkers=1
pnpm --dir plugins/@dshfiles/ai-accounts build
pnpm --dir plugins/@dshfiles/ui-styles build
node -e "import('./plugins/@dshfiles/ai-accounts/dist/index.js')"
```

Tests cover real isolated JSON storage/restart, failover success versus failure,
late completion/cancellation, native-source forgetting, retention, strict metadata,
raw API/tool authorization and query cancellation across chats. They do not prove
browser rendering. The account-specific Gherkin scenarios
`ai-accounts.active-chat-switch` and `ai-accounts.active-chat-account` are the
browser checks; use the existing focused browser runner after its executable
selection prerequisite is coordinated. Do not import unrelated shared verifier
changes into this patch.

## Deterministic UI reach (scratch only)

1. Boot stock DSH in a disposable home with AI Accounts and the existing scratch
   workspace fixture. Use the shared verifier's explicit stock-CLI/system-Chrome
   overrides when needed; never use a personal launcher that rewrites DSH_HOME.
2. The existing `tool-call-thread` seed uses a loopback-only fake Command Code
   provider. Open catalog feature `ai-accounts/active-chat-account`. After the
   synthetic turn finishes, the sidebar's `[data-active-account]` button has
   `aria-current="true"` and visible **Last used by active chat** text.
3. For distinct sources, the switch scenario adds two synthetic Command Code
   accounts (ALPHA1 and BRAVO2) using that loopback provider, then sends one turn
   per route. Select each thread; exactly its source is marked. New blank draft:
   no marker. Hide the second quota meter via its existing context menu: its
   compact source chip remains, marked **Quota unavailable or hidden**.
4. The failover scenario starts with synthetic LIMITED and healthy BRAVO2.
   The fake request ledger proves LIMITED was tried first and BRAVO2 answered;
   only the latter is highlighted after settlement.
5. Capture a new synthetic screenshot of that settled source (and collapsed
   rail if desired), check console/activation errors, then stop the scratch
   instance and fake provider. Never reuse personal account screenshots, start
   real sign-in, or point a synthetic route at an external provider.

A local build/import check is not evidence that the browser journeys passed.
Review their fresh receipts and a new synthetic screenshot before publishing;
never verify against the live runtime, profile, secrets or provider consent.
