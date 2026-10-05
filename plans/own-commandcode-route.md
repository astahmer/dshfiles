# Own the Command Code provider route

> **Status:** plan only, nothing implemented. The route our plugin already
> registers is unconfigured, so `@mars-sea/dsh-commandcode-provider` serves every
> Command Code request today. Removing it is the last step, not the first.

## Context

- The owned [AI Accounts plugin](../../plugins/@dshfiles/ai-accounts) already
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

### Phase 1 — prove the wire before porting anything

Do not start by porting. Two cheap checks decide whether the whole plan is worth
its cost, and both are read-only.

1. **Does pi-ai already classify an empty completion?** Write a scratch test
   that feeds `createCommandCodeProvider`'s stream a response carrying only a
   `reasoning` delta and a terminal marker. Assert it raises a classified
   failure rather than yielding an empty assistant message. If pi-ai already
   does this, the defect is `@mars-sea`-specific and this repository inherits
   nothing.
2. **Does pi-ai's transport already expose `providerRetryPolicy` and image
   pricing?** If the seams exist, Phase 2 is configuration, not a transport
   rewrite.

Write the findings into this file before Phase 2. A plan whose first phase can
return "the third-party plugin is the entire problem, ours is already correct"
is worth running.

### Phase 2 — configure the route, keeping `@mars-sea` installed

Add a `kind: commandcode` account to the `web` profile's `opencodeAccounts` so
our plugin registers the route alongside the existing one. Two providers may
compete for the route name; which one wins must be read from the composed config
and the boot log, not assumed.

Verify on a second instance (`dsh --profile probe --port <free>`), never `3080`:
`dsh --profile probe --dump-config` shows the row, the boot log reports no entry
that failed to activate, and a real request is answered by our route.

### Phase 3 — port the four capabilities

Port each behind a test that fails before the port. Follow
`plans/repo-hardening/README.md` rules already in force: key variables end in
`_API_KEY`, every read goes through `readKeyFromEnv`, a Command Code base must be
https on `commandcode.ai` or a loopback address, and model discovery passes the
key value rather than an env name.

The empty-response classification is the one that earns its own regression test
and its own review, because it is the defect this plan exists to remove.

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
