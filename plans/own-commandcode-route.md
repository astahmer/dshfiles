# Own the Command Code provider route

> **Status:** Phase 1 complete, and its answer changes this plan. Our route would
> inherit the same defect, so this is a *fix*, not a move.
> `@mars-sea/dsh-commandcode-provider` serves every Command Code request today
> and its removal stays the last step.

## Context

- The owned [AI Accounts plugin](../plugins/@dshfiles/ai-accounts) already
  speaks Command Code. `src/commandcode-provider.ts` points pi-ai's own OpenAI
  transport at `https://api.commandcode.ai`, declares per-model which API serves
  it (`openai-completions`, `openai-responses`, `anthropic-messages`), and
  `src/host.ts:429` builds one provider per keyed account whose `kind` is
  `commandcode`.
- The route is **inert**. `src/account-config.ts:58` declares
  `opencodeAccounts` defaulting to `[]`, and the `web` profile supplies only
  `codexAccounts`. Nothing selects a `kind: commandcode` account, so no Command
  Code route is registered by our plugin.
- `@mars-sea/dsh-commandcode-provider` 0.12.3 therefore owns the route. The `web`
  profile composes it as entry `llm-commandcode` with `apiKeyEnv:
  COMMANDCODE_API_KEY`, `visibleModels: [stealth/space-bunny-alpha, gpt-6-luna]`,
  and `showSidebarQuota: true`.
- That plugin has a defect this repository already diagnosed. In
  `handleCliEvent`, `reasoning-delta` accumulates `asm.reasoningContent` but
  never sets `asm.sawContent`, while `text-delta` and `tool-call` both do. A
  reasoning-only completion therefore reads as empty, and
  `emptyCompletionError` classifies it by finish reason — returning
  `OUTPUT_TOKEN_LIMIT`, which is absent from its own `providerRetryPolicy`
  `retryableCodes`. No retry, no error, a silent empty turn.
  `@deepseek-ai/dsh-goal-round-driver` has no no-progress guard, so a goal with
  an active budget consumed 111 consecutive empty rounds over 60.9 hours in
  `session-dbe87c63`. Our [`@dshfiles/goal-stall-guard`](../plugins/@dshfiles/goal-stall-guard)
  now bounds that; it does not prevent it.
- Our own provider is not exempt by construction. `createCommandCodeProvider`
  wraps pi-ai's generic machinery, so whether a reasoning-only completion reads
  as empty depends on pi-ai's stream handling, not on code we wrote. **The
  replacement must prove the empty-response case is classified as a failure.**

## Goal

Every Command Code request is served by code in this repository, with the
account pool, reasoning tiers, retry policy, and quota footer it has today, and
with an empty model response classified as a retryable failure rather than a
silent completed turn.

## Why

The third-party route is the only place a degraded provider response becomes an
unbounded goal loop, and its fix history shows the empty-response classification
was added and then rolled back (`0.12.2`: "回退了 issue #73 为同一机制加的空响应改判分支").
We should not depend on an upstream that has already regressed this once, for a
route whose wire format is plain OpenAI-compatible HTTP we can implement.

## What

Move the `commandcode` route from `@mars-sea/dsh-commandcode-provider` to
`@dshfiles/ai-accounts`, carrying over four capabilities that route has and ours
does not. `@dshfiles/goal-stall-guard` is the safety net, not the fix.

### Gap analysis, measured against the installed 0.12.3

| Capability | `@mars-sea` | ours | Action |
|---|---|---|---|
| Account pool, sticky distribution, failover | 68 refs | none | port |
| `providerRetryPolicy` (bounded backoff, `EMPTY_RESPONSE`) | present | none | port, and fix the classification |
| Reasoning-effort tiers (`off`/`low`/`high`/`max`) | present | catalog-level `api` only | port |
| Image request pricing | present | none | port |
| Sidebar quota footer | present | usage panel exists | reuse ours |
| Model curation / hidden models | present | present | ours already wins |
| Empty-response classification | defective | unproven | **prove it** |

## How

### Phase 1 — DONE. The answer is the opposite of the hopeful one

Both checks ran. The result is recorded here so Phase 2 starts from evidence
rather than from the assumption the phase was written under.

**Check 1: does pi-ai classify a reasoning-only completion? No.**

`plugins/@dshfiles/ai-accounts/src/pi-ai-empty.test.ts` drives pi-ai's real
`openai-completions` transport with a synthetic SSE body — no network. A response
carrying `reasoning_content` and a clean `finish_reason: "stop"`, with no answer
text and no tool call, ends the stream as:

```
{ threw: false, blockTypes: ['thinking_delta'], stopReason: 'stop' }
```

The transport reports success with no model-visible content. `pi-ai` is not the
innocent bystander the plan hoped for: `createCommandCodeProvider` wraps exactly
this transport, so **our route inherits the defect unchanged**. Swapping the
provider without fixing this carries the goal livelock across.

The test asserts the contract we want (a reasoning-only response must raise) and
therefore fails today on purpose. Its control passes: the same body with answer
text yields a `text_delta`, so the harness can see content when it exists.

> The control caught a real error first. The event union is `text_delta` /
> `thinking_delta` / `toolcall_delta`, not the block names. The first version
> matched on `text`, reported an empty stream for *every* response, and would
> have "confirmed" the defect for the wrong reason. A harness that cannot see a
> passing case cannot be trusted to see a failing one.

**Check 2: do the seams exist?** Partially.

| Seam | pi-ai | Consequence |
|---|---|---|
| `maxRetries` | present (`dist/types.d.ts:101`) | retry is configuration, not a rewrite |
| `retryableCodes` | **absent** | the *classification* is ours to own — and that is the bug |
| `imageRequestPricing` | **absent** | Phase 3 must add it |
| reasoning effort tiers | present, `reasoning_effort` + `thinkingFormat` | portable |

**Consequence: the fix belongs at our provider boundary, not in pi-ai.** pi-ai
exposes the retry budget but nothing classifies a failure for it, so a wrapper
that raises `LlmError` with a code is the whole remedy.

### Phase 2 — configure the route, keeping `@mars-sea` installed

> **2026-10-10 finding.** `~/.dsh/plugins/ai-accounts/accounts.json` already has an
> enabled `commandcode` account, so composing `@mars-sea` next to it failed the boot
> with `DUPLICATE_ADAPTER`. AI Accounts now leaves out an account whose provider id
> another plugin already registered and lists it under `skipped` in `ai_accounts`
> status, so `@mars-sea` keeps serving the route. Our route is **not** working yet:
> on a scratch `web` copy it ended a turn with `404 status code (no body)` while
> `@mars-sea` answered the same prompt. Its provider auth resolves only a stored
> credential or `COMMANDCODE_API_KEY`, not `~/.commandcode/auth.json` (only the usage
> reader reads that file), and it advertises no reasoning tiers.

> **2026-10-11 finding: the 404 was our base path, and a Go plan cannot use our route at all.**
> A live `web` turn on `commandcode/gpt-6-luna` (session-56629e61) ended with
> `404 status code (no body)` / `PI_AI_ERROR`, served by AI Accounts' pi-ai route:
> the live `~/.dsh/profiles/web/package.json` bundles omit `@mars-sea/dsh-commandcode-provider`,
> so its `llm-commandcode` patch row is orphaned (`patch: entry "llm-commandcode" not found`)
> until `nixapply` re-syncs the seed from `profiles/web`. Root cause of the 404: our base was
> `/provider`, so pi-ai posted to `/provider/chat/completions`; the Provider API lives at
> `/provider/v1/chat/completions` (and `/provider/v1/messages` for Claude). Fixed, plus: the key
> falls back to `~/.commandcode/auth.json`, the catalog reads `supported_endpoints` (Claude ids
> no longer carry `anthropic/`), and `anthropic-messages` is registered. The fixed route then
> gets `403 upgrade_required`: **the Go plan has no Provider API access**; only the CLI
> transport (`/alpha/generate`, CLI-version headers) serves it, which `@mars-sea` implements
> and we do not. That refusal now names the remedy (`nixapply` + restart). Porting the CLI
> transport is the real prerequisite for Phase 4 on a Go plan. Effort tiers still absent
> (`reasoning: false`), so an `agent-default-model` row with `reasoningEffort` is refused.

Add a `kind: commandcode` account to the `web` profile's `opencodeAccounts` so
our plugin registers the route alongside the existing one. Two providers may
compete for the route name; which one wins must be read from the composed config
and the boot log, not assumed.

Verify on a second instance (`dsh --profile probe --port <free>`), never `3080`:
`dsh --profile probe --dump-config` shows the row, the boot log reports no entry
that failed to activate, and a real request is answered by our route.

**The live check already works and is worth reusing.** Against a booted probe
instance, the Command Code catalog answers on the gateway:

```bash
# inside the page, cookie minted with .local/mint-dsh-cookie.mjs <port>
fetch('/api/commandcode/models', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({
    type: 'client-request',
    rpcId: crypto.randomUUID(),
    method: 'commandcode/models',
    payload: { args: {} },
  }),
})
```

The envelope is not guessable: `method` must equal the endpoint path minus
`/api/`, and `payload` must be exactly one plain-object `args` field. Getting
either wrong returns a gateway error that looks like an empty catalog. Confirmed
live on `probe` — 85 models, including `stealth/space-bunny-alpha`, tier `go`,
and it is the default for `commandcode` in `/api/session/modelCatalog`.

### Phase 3 — port the four capabilities

Port each behind a test that fails before the port. Follow
`plans/repo-hardening/README.md` rules already in force: key variables end in
`_API_KEY`, every read goes through `readKeyFromEnv`, a Command Code base must be
https on `commandcode.ai` or a loopback address, and model discovery passes the
key value rather than an env name.

**The empty-response classification comes first, not last.** Phase 1 showed
`retryableCodes` does not exist in pi-ai, so nothing upstream will ever raise it
for us. `createCommandCodeProvider` must wrap the transport and turn a stream
that settles with no answer text and no tool call into an `LlmError` carrying a
code the retry policy already retries. `src/pi-ai-empty.test.ts` turns green
when that lands, and it is the one test in this plan that fails on arrival.

### Phase 4 — remove the third-party route

Only after Phase 3 is proven on a second instance:

- drop `llm-commandcode` from `~/.dsh/profiles/web/cordis.patch.yml`
- drop the `@mars-sea/dsh-commandcode-provider` dependency from the profile
  manifest and run `pnpm install`
- move any provider-specific config that has no equivalent (`visibleModels`,
  `modelVisibility`, `showSidebarQuota`) into the account config
- re-run `dsh --profile web --dump-config` and confirm no reference remains

Removing it before the four capabilities are ported regresses reasoning tiers
and the retry policy, which is a worse state than the bug being fixed.

## Gates

- `pnpm -r --filter './@dshfiles/*' run typecheck`
- `pnpm -r --filter './@dshfiles/*' run test`
- `pnpm -r --filter './@dshfiles/*' run build`
- `pnpm run contract` — currently fails on a pre-existing `@dshfiles/shortcuts`
  gap (missing `scripts.test` and `scripts.typecheck`); unrelated to this plan
- boot verification on a second instance, boot log captured

## Risks

- **Reasoning tiers regress silently.** `stealth/space-bunny-alpha` currently
  offers `max`. If the port drops it, the model still answers, just with less
  reasoning. Check the effort list, not just that requests succeed.
- **Two providers, one route name.** Phase 2 makes this real. If registration
  order decides the winner, the wrong provider may serve requests while both
  boot clean. Confirm from the composed config which row is live.
- **`@mars-sea` is not frozen.** Removing it also removes catalog sync, pricing
  tables, and upstream CLI fixes. Deciding we own the route means owning that
  maintenance, which is the trade being made deliberately.
- **pi-ai may change under us.** Our provider is a thin wrapper; a pi-ai change
  moves our behavior without a version bump in this repository. Phase 1's tests
  are the only thing that would catch it.

## Deliberately not doing

- **Not vendoring `@mars-sea`.** A fork of a 10k-line provider carries more debt
  than the feature is worth. The wire is OpenAI-compatible; we implement the
  parts we use.
- **Not extending the `@dshfiles/dshx` fork for this.** The route registration
  seam already exists in `dsh-llm`; nothing here needs new toolchain surface.
- **Not touching `plans/claude-cursor-accounts.md`.** That plan states the
  existing Command Code route keeps its behavior, which is true until Phase 4
  lands and needs updating then.
