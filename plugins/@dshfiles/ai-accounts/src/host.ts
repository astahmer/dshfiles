import { activateAccountRuntime } from './account-runtime.js'
import { createServingAccountService } from './serving-account.js'
import { servingAccountHostApi } from './serving-account-host.js'
import { threadAccountHostApi } from './thread-account-host.js'
import { configFromAccountsFile } from './account-config.js'
// Brings in the CSS-module declarations a plugin would otherwise restate.
import type {} from '@dshfiles/dshx/client'
import { AccountsHostApiModel, accountsHostApi } from './accounts-host-api.js'
import { AccountLoginHostModel, accountLoginHostApi, installAccountLogin } from './account-login-host.js'
import { accountSessionHostApi } from './account-session-host.js'
import { closeModelFallbacks, modelFallbackHostApi, modelFallbacksFor } from './model-fallback-host.js'
import { createModelFallbackRouter } from './model-fallback-router.js'
import type { ModelFallbackStore } from './model-fallback-store.js'
import type { FallbackRoute } from './model-fallback-api.js'
import { readAccountUsage } from './account-usage.js'
import { UsageSnapshot } from './usage-snapshot.js'
import { UsageSnapshotPromiseModel, type UsageSnapshotPromise } from './usage-snapshot-promise.js'
import { UsageHistorySchedule } from './usage-history-schedule.js'
import { UsageHistoryPromiseModel } from './usage-history-promise.js'
import { readCodexUsage } from './usage.js'
import { createCopilotLoginService } from './copilot-login.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { CLAUDE_CLI_TOKEN, ClaudeCliSessions } from './claude-cli.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { aiAccountsSettings, type AccountSettingsSnapshot } from './settings.js'
import { AccountSettings } from './account-settings-service.js'
import { shouldUseLunaReserve, withLunaReserve } from './codex-luna-reserve.js'
import { FastModeService, isCodexFastModeModel, withCodexFastMode } from './codex-fast-mode.js'
import { createFastModeUsageHistoryService } from './fast-mode-usage-history.js'
import { modelFastModeHostApi } from './model-fast-mode-host.js'
import { DEFAULT_PRICING_PATH } from './pricing-catalog.js'
import { PricingCatalog } from './pricing-catalog-service.js'
import { PricingCatalogPromiseModel, type PricingCatalogPromise } from './pricing-catalog-promise.js'
import { ModelCatalogs } from './model-catalogs.js'
import { ModelCatalogsPromiseModel, type ModelCatalogsPromise } from './model-catalogs-promise.js'
import { installCostProjection } from './cost-projection.js'
import { AccountHomePolicy } from './account-home-policy.js'
import { AccountProfilesModel, AccountStore, type AccountStoreFile } from './account-store.js'
import { AccountStorePromiseService, type AccountStorePromise } from './account-store-promise.js'
import { createAccountSetupService } from './account-setup-service.js'
import { verifyAccountConnection } from './account-connection-verification.js'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { lstatSync, realpathSync, rmSync } from 'node:fs'
import { aiAccountsTool } from './accounts-tool.js'
import { createUsageHistoryService } from './usage-recorder.js'
import { CommandCodeCapabilities } from './commandcode-capabilities.js'
import { fetchCommandCodeCatalog, createCommandCodeProvider } from './commandcode-provider.js'
import { CredentialModel, resolveKeyFromContext } from './credentials.js'
import { fetchOpenCodeGoCatalog } from './opencode-go-catalog.js'
import { DshxPlugin, HostContext } from '@dshfiles/dshx/effect'
import { HostApis } from '@dshfiles/dshx/effect/host-apis'
import { AccountsPlatformLive } from './platform-layer.js'
import { AccountLocks } from './account-locks.js'
import type { Context } from '@deepseek-ai/cordis'
import { Effect, Layer, Stream, SubscriptionRef } from 'effect'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { createProvider } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { createCopilotCredentialsService } from './copilot-credentials.js'
import { GITHUB_COPILOT_KIND } from './provider-routes.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, GenerateOptions } from '@deepseek-ai/dsh-llm'
// Value imports, not `import type {}`: an empty type-only import is elided and
// never loads the package's cordis module augmentation, which is what makes
// `ctx.on('llm/stream')` and the agent-scoped listeners typecheck here.
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { AccountPool } from './account-pool.js'
import { RequestRouting, type RoutingWorld } from './request-routing.js'
import { RequestRoutingHooks } from './request-routing-promise.js'
import { FailureRecoveryModel } from './failure-recovery.js'
import { RequestAccountRouting } from './request-account-routing.js'
import { randomUUID } from 'node:crypto'
import { CodexCredentialStore } from './codex-credential.js'
import { createQuotaContinuationService } from './quota-continuation.js'
import { QuotaAttention } from './quota-attention.js'
import { ProviderProfileModel, EffortPinnedAdapter } from './provider-profile.js'
import { DeclaredRetryAfter } from './provider-retry-after.js'
import { AccountModelSettingsModel } from './account-model-settings.js'
import { CLAUDE_KIND, COMMANDCODE_KIND, CODEX_KIND, OPENCODE_KIND, ProviderRoutes, type KeyedRoute, type Route } from './provider-routes.js'

/**
 * Per-account Codex and OpenCode Go provider instances for DeepSeek Harness.
 *
 * Every configured account becomes its own LLM route, so the model picker offers
 * `codex` plus `codex_personal`, `codex_work`, and so on, each reading a
 * different login. One `PiAiAdapter` serves all of them.
 *
 * Driver kinds (`codex`, `opencode-go`) stay separate from instance slugs so one
 * driver can run several accounts at once. That split is T3 Code's
 * `ProviderDriverKind` / `ProviderInstanceId` pair, and it is what lets
 * `registerAdapter` take every route in a single call.
 *
 * Account layout and the shadow-home trick follow T3 Code's
 * `provider/Drivers/CodexHomeLayout.ts`.
 */

/** A Luna Reserve switch outlives a stale usage card for this long, then the card decides again. */
const LUNA_RESERVE_HOLD_MS = 60 * 60_000

interface AccountsHostActivation {
  /** What request routing decides with; absent when the Host has no LLM runtime. */
  readonly world: RoutingWorld | undefined
}

/**
 * The imperative account Host still being split into services: everything it starts registers its release in
 * `onRelease`, which the plugin Scope runs in reverse order when the plugin unloads.
 */
const startAccountsHost = (input: {
  readonly ctx: Context
  readonly readSettings: () => AccountSettingsSnapshot
  readonly store: AccountStorePromise
  readonly pool: AccountPool['Service']
  readonly routing: RequestRouting['Service']
  readonly usage: UsageSnapshotPromise
  readonly usageHistory: { readonly collectNow: () => Promise<number> }
  readonly pricing: PricingCatalogPromise
  readonly modelCatalogs: ModelCatalogsPromise
  readonly onRelease: (release: () => void) => void
}): AccountsHostActivation => {
  const { ctx, readSettings, store, onRelease } = input
  const pool = input.pool.view
  const resolveCredential = resolveKeyFromContext(ctx)
  const runtime = activateAccountRuntime(ctx)
  const servingAccount = createServingAccountService(ctx)
  runtime.servingAccount = servingAccount
  onRelease(() => {
    if (runtime.servingAccount === servingAccount) delete runtime.servingAccount
    void servingAccount.close().catch(() => ctx.logger.warn('ai-accounts: serving account storage could not close cleanly'))
  })
  const copilotCredentialReader = createCopilotCredentialsService(ctx.get('credentials')).read
  runtime.accountSetup = createAccountSetupService({
    store,
    resolveCredential,
    observeExisting: async draft => {
      const file = await store.readAccountFile()
      return (
        await AccountProfilesModel.buildAccountsFile(
          { ...file, accounts: [draft] },
          [],
          resolveCredential,
          async id => (await copilotCredentialReader(id)) !== undefined,
        )
      ).accounts[0]
    },
    verify: request => {
      const pendingHome = request.method === 'device' ? runtime.accountLogin?.pendingHome(request.account.instanceId) : undefined
      return verifyAccountConnection({
        ...request,
        readCopilotCredential: async id => runtime.copilotLogin?.readPending(id) ?? copilotCredentialReader(id),
        ...(pendingHome !== undefined && {
          readAccountUsage: async (probe: Parameters<typeof readAccountUsage>[0]) =>
            probe.account.kind === 'codex' ? readCodexUsage(pendingHome, probe.signal, probe.onAuthenticated) : readAccountUsage(probe),
        }),
      })
    },
    saveKey: async (reference, _owner, value, accepted) => {
      if (!accepted()) throw new Error('Account connection cancelled.')
      // This private reference was never published before verification. Native ownership keeps all later edits/metadata in parity.
      const ref = credentialRef(reference)
      const information = await ctx.credentials.describe(ref)
      if (information.configured || !information.writable) throw new Error('The private connection reference is already owned or is not writable.')
      await ctx.credentials.set(ref, value)
    },
    adoptCredential: async id => {
      await runtime.accountLogin?.commitPending(id)
      await runtime.copilotLogin?.commitPending(id)
    },
    cancelLogin: id => {
      runtime.accountLogin?.cancel(id)
      runtime.copilotLogin?.cancel(id)
    },
    settleLogin: async id => {
      await runtime.accountLogin?.settledAccount(id)
    },
    cleanupCandidate: async draft => {
      await runtime.accountLogin?.settledAccount(draft.instanceId)
      const file = await store.readAccountFile()
      if (
        file.accounts.some(
          account =>
            AccountHomePolicy.containsConfiguredHome(draft.homePath, account.homePath) ||
            AccountHomePolicy.containsConfiguredHome(draft.homePath, account.shadowHomePath),
        )
      )
        return
      if (draft.kind !== 'codex' && draft.kind !== 'claude') return
      const path = draft.homePath
      if (!AccountHomePolicy.isManagedSetupHome(path, draft.kind)) return
      try {
        // Check exact trusted absolute target and all resolved ancestors before recursive removal.
        if (realpathSync(path) !== path || !lstatSync(path).isDirectory()) throw new Error('Unsafe pending account home')
        rmSync(path, { recursive: true, force: true })
      } catch (error) {
        if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error
      }
    },
    onCommit: async () => {
      runtime.usageCache?.invalidate()
      await runtime.refreshRoutes?.()
    },
  })
  installAccountLogin(ctx, store)
  const usageHistory = createUsageHistoryService(ctx)
  const fastModeUsageHistory = createFastModeUsageHistoryService(ctx, {
    readRetentionDays: async () => (await usageHistory.readSettings()).retentionDays,
  })
  runtime.fastModeUsageHistory = fastModeUsageHistory
  runtime.scheduler = input.usageHistory
  // 30 s: long enough that the page, footer and edge overlay share one sweep,
  // short enough that a manual reload still feels live.
  onRelease(() => {
    if (runtime.scheduler === input.usageHistory) delete runtime.scheduler
    if (runtime.fastModeUsageHistory === fastModeUsageHistory) delete runtime.fastModeUsageHistory
    void usageHistory.close().catch(() => ctx.logger.warn('ai-accounts: usage history storage could not close cleanly'))
    void fastModeUsageHistory.close().catch(() => ctx.logger.warn('ai-accounts: Fast mode usage storage could not close cleanly'))
  })
  runtime.usageCache = input.usage
  installCostProjection(ctx)
  let fallbackStore: ModelFallbackStore | undefined
  void modelFallbacksFor(ctx)
    .then(store => {
      fallbackStore = store
    })
    .catch(() => ctx.logger.warn('ai-accounts: model fallback storage could not open; threads keep account-level fail-over'))
  onRelease(() => {
    void closeModelFallbacks().catch(() => ctx.logger.warn('ai-accounts: model fallback storage could not close cleanly'))
  })
  const quotaContinuations = createQuotaContinuationService({
    context: ctx,
    readResetAt: accountId => AccountsHostApiModel.readQuotaResetAt(ctx, store, accountId),
  })
  runtime.quotaContinuations = quotaContinuations
  const stopQuotaContinuations = quotaContinuations.start()
  onRelease(() => {
    stopQuotaContinuations()
    if (runtime.quotaContinuations === quotaContinuations) delete runtime.quotaContinuations
    void quotaContinuations.close().catch(() => ctx.logger.warn('ai-accounts: quota recovery storage could not close cleanly'))
  })
  // The store layer read the file before activation, so routes exist by the time the plugin is active.
  const initialFile = store.current()
  let config = configFromAccountsFile(initialFile)
  let routes = ProviderRoutes.buildRoutes(config).routes
  let profiles = new Map<string, ResolvedPiAiProviderProfile>()
  const fastMode = new FastModeService({
    isEnabledByDefault: () => readSettings().fastModeDefault,
    isAvailable: route => {
      if (routes.get(route.provider)?.kind !== CODEX_KIND) return false
      const model = profiles
        .get(route.provider)
        ?.piProvider?.getModels()
        .find(candidate => candidate.id === route.model)
      return model !== undefined && isCodexFastModeModel(model)
    },
    isLiveSession: sessionId => ctx.agents.get(SessionId(sessionId)) !== undefined,
    recordUsage: fastModeUsageHistory.record,
    onUsageError: error => ctx.logger.warn('ai-accounts: Fast mode usage could not be persisted (%s)', error instanceof Error ? error.name : 'unknown error'),
  })
  runtime.fastMode = fastMode
  const registerFastModeCleanup = (agent: Agent): void => {
    agent.ctx.effect(() => () => fastMode.delete(agent.id), 'ai-accounts: Fast mode session state')
  }
  for (const agent of ctx.agents.list()) registerFastModeCleanup(agent)
  ctx.on('agent/created', ({ agent }) => {
    registerFastModeCleanup(agent)
    return undefined
  })
  const copilotLogin = createCopilotLoginService({
    credentials: ctx.credentials,
    isCopilotAccount: instanceId =>
      store.current().accounts.some(account => account.instanceId === instanceId && account.kind === 'github-copilot') ||
      runtime.accountSetup?.candidate(instanceId)?.kind === 'github-copilot',
    isPendingAccount: instanceId => runtime.accountSetup?.candidate(instanceId) !== undefined,
    onChange: () => runtime.usageCache?.invalidate(),
  })
  runtime.copilotLogin = copilotLogin

  const codexUpstream = openaiCodexProvider()
  const codexFastUpstream = withCodexFastMode({ upstream: codexUpstream, fastMode })
  const opencodeUpstream = opencodeGoProvider()
  const claudeUpstream = anthropicProvider()
  const claudeCli = new ClaudeCliSessions({
    configDir: provider => {
      const route = routes.get(provider)
      return route?.kind === CLAUDE_KIND ? route.configDir : ClaudeAccountModel.resolveClaudeConfigDir('')
    },
  })
  onRelease(() => claudeCli.dispose())
  // Same catalog as the Messages API; requests run through the account's Claude Code CLI login (see claude-cli.ts).
  const claudeCliUpstream = createProvider({
    id: claudeUpstream.id,
    name: 'Claude Code',
    auth: claudeUpstream.auth,
    models: claudeUpstream.getModels(),
    api: {
      stream: (model, context, options) => claudeCli.stream(model, context, options),
      streamSimple: (model, context, options) => claudeCli.stream(model, context, options),
    },
  })
  const githubCopilotUpstream = githubCopilotProvider()
  const declaredRetryAfter = new DeclaredRetryAfter()
  /** Codex accounts a quota failure sent to Luna Reserve ahead of their usage card, until this time. */
  const lunaReserveHolds = new Map<string, number>()
  const lunaReserveHeld = (id: string, now: number): boolean => (lunaReserveHolds.get(id) ?? 0) > now
  const catalogState = input.modelCatalogs
  const sameKeyedRoute = (candidate: Route | undefined, expected: KeyedRoute): boolean => {
    if (candidate === undefined || !candidate.enabled) return false
    if (expected.kind === COMMANDCODE_KIND) {
      return (
        candidate.kind === COMMANDCODE_KIND &&
        candidate.apiBaseUrl === expected.apiBaseUrl &&
        candidate.apiKeyEnv === expected.apiKeyEnv &&
        candidate.authSource === expected.authSource
      )
    }
    return (
      candidate.kind === OPENCODE_KIND &&
      candidate.apiBaseUrl === expected.apiBaseUrl &&
      candidate.apiKeyEnv === expected.apiKeyEnv &&
      candidate.authSource === expected.authSource
    )
  }
  // Each keyed provider is built with its own base and key variable, so two
  // Command Code accounts can point at different deployments.
  const keyedUpstream = (route: KeyedRoute) =>
    route.kind === COMMANDCODE_KIND
      ? createCommandCodeProvider({
          baseUrl: route.apiBaseUrl,
          keyEnv: route.apiKeyEnv,
          authSource: route.authSource,
          resolveCredential,
          readFallbackKey: () => readCommandCodeKey(route.apiKeyEnv, resolveCredential, route.authSource),
        })
      : opencodeUpstream
  // Per-account, per-model default efforts, read from the same file as the
  // routes so a pin can never outlive the account that declared it.
  //
  // The pin is applied as a pi-ai model override rather than in the request
  // waterfall: a loop-built request arrives deep-frozen and `next()` takes no
  // replacement, so the request cannot be edited here. The adapter's own
  // default is the seam DSH materializes defaults through, so a pin applies
  // whenever the caller did not choose an effort.
  // Curation comes from the same file, so a hidden model cannot outlive the
  // account that hid it.
  const buildProfiles = (
    nextRoutes: ReadonlyMap<string, Route>,
    sourceFile: AccountStoreFile,
    forEditing = false,
  ): Map<string, ResolvedPiAiProviderProfile> => {
    const enabled = [...nextRoutes].filter(([, route]) => route.enabled || forEditing)
    const settings = new Map(
      sourceFile.accounts.map(account => [
        ProviderRoutes.normalizeInstanceId(account.instanceId, account.kind),
        forEditing
          ? { ...account, reasoningDefaults: {}, defaultReasoningEffort: null, hiddenModelIds: [], favoriteModelIds: [], modelOrder: [] }
          : AccountModelSettingsModel.effectiveModelSettings(account),
      ]),
    )

    const upstreamFor = (id: string, route: Route) => {
      if (route.kind === CODEX_KIND) {
        return withLunaReserve({
          upstream: codexFastUpstream,
          onReserve: () =>
            readSettings().lunaReserveRouting &&
            (lunaReserveHeld(id, Date.now()) ||
              shouldUseLunaReserve(runtime.usageCache?.latest()?.cards.find(card => card.instanceId === id)?.usage, Date.now())),
        })
      }
      if (route.kind === CLAUDE_KIND) return ClaudeAccountModel.usesCliTransport(route) ? claudeCliUpstream : claudeUpstream
      if (route.kind === GITHUB_COPILOT_KIND) return githubCopilotUpstream
      return keyedUpstream(route)
    }

    return new Map<string, ResolvedPiAiProviderProfile>(
      enabled.map(([id, route]) => [
        id,
        ProviderProfileModel.buildProfile({
          upstream: upstreamFor(id, route),
          onResponse: response => declaredRetryAfter.observe(id, response, Date.now()),
          provider: id,
          displayName: route.displayName,
          ...settings.get(id),
          additionalModelIds: [...(settings.get(id)?.additionalModelIds ?? []), ...(catalogState.discovered(id) ?? [])],
        }),
      ]),
    )
  }

  const buildReasoningDefaults = (): Map<string, Readonly<Record<string, string>>> =>
    new Map([...profiles].map(([id, profile]) => [id, ProviderProfileModel.reasoningDefaultsForProfile(profile)]))

  profiles = buildProfiles(routes, initialFile)
  const reasoningDefaults = buildReasoningDefaults()

  runtime.accounts = { config, pool }

  const modelForRoute = (provider: string, modelId: string) =>
    profiles
      .get(provider)
      ?.piProvider?.getModels()
      .find(candidate => candidate.id === modelId)
  const modelsCompatible = (sourceProvider: string, candidateProvider: string, modelId: string): boolean => {
    const source = modelForRoute(sourceProvider, modelId)
    const candidate = modelForRoute(candidateProvider, modelId)
    if (source === undefined || candidate === undefined) return false
    return (
      source.api === candidate.api &&
      source.reasoning === candidate.reasoning &&
      source.contextWindow === candidate.contextWindow &&
      source.maxTokens === candidate.maxTokens &&
      JSON.stringify([...source.input].sort()) === JSON.stringify([...candidate.input].sort()) &&
      JSON.stringify(source.inputLimits ?? null) === JSON.stringify(candidate.inputLimits ?? null) &&
      JSON.stringify(source.thinkingLevelMap ?? null) === JSON.stringify(candidate.thinkingLevelMap ?? null)
    )
  }
  const fallbackAvailable = (route: { readonly provider: string }, now: number): boolean =>
    routes.has(route.provider)
      ? pool.isHealthy(route.provider, now)
      : (ctx
          .get('llm')
          ?.listProviders()
          .some(provider => provider.id === route.provider) ?? false)
  // A Codex or OpenCode Go account fails over to its sibling accounts with the same model, one rung each.
  // Claude never joins a family: it neither falls back nor is a fail-over target.
  const familySiblings = (input: { readonly provider: string; readonly model: string | undefined }): readonly FallbackRoute[] | undefined => {
    const model = input.model
    if (model === undefined || model === '') return undefined
    const settings = readSettings().recovery
    return RequestAccountRouting.failoverAccountIds({
      from: input.provider,
      model,
      routes,
      distribution: pool.distribution(),
      usageOrder: settings.usageOrder,
      hiddenAccountIds: settings.hiddenUsageAccounts,
      modelsCompatible,
    }).map(provider => ({ provider, model }))
  }
  const fallbackRouter = createModelFallbackRouter({
    store: () => fallbackStore,
    distribution: () => pool.distribution(),
    available: fallbackAvailable,
    siblings: familySiblings,
    onError: message => ctx.logger.warn(`ai-accounts: ${message}`),
  })
  runtime.modelFallbackRouter = fallbackRouter
  onRelease(() => {
    if (runtime.modelFallbackRouter === fallbackRouter) delete runtime.modelFallbackRouter
  })
  const recovery = FailureRecoveryModel.create({
    pool,
    isAccountRoute: provider => routes.has(provider),
    readPolicy: () => readSettings().recovery.policy,
    failoverCandidates: ({ from, model }) => {
      const settings = readSettings().recovery
      return RequestAccountRouting.failoverAccountIds({
        from,
        model,
        routes,
        distribution: pool.distribution(),
        usageOrder: settings.usageOrder,
        hiddenAccountIds: settings.hiddenUsageAccounts,
        modelsCompatible,
      })
    },
    lunaReserve: {
      available: id => {
        if (routes.get(id)?.kind !== CODEX_KIND || !readSettings().lunaReserveRouting) return false
        const now = Date.now()
        const usage = runtime.usageCache?.latest()?.cards.find(card => card.instanceId === id)?.usage
        if (lunaReserveHeld(id, now) || shouldUseLunaReserve(usage, now)) return false
        if (usage === undefined || usage.status !== 'ok') return true
        return usage.windows.some(window => window.reserve === true && Math.round(window.percentRemaining) > 0)
      },
      engage: id => {
        lunaReserveHolds.set(id, Date.now() + LUNA_RESERVE_HOLD_MS)
        runtime.usageCache?.invalidate()
      },
    },
    chain: {
      candidates: ({ conversationKey, current, now }) => fallbackRouter.candidates({ sessionId: conversationKey, current, now }),
      bind: ({ conversationKey, to }) => fallbackRouter.bind({ sessionId: conversationKey, to }),
    },
    newRetryId: () => randomUUID(),
  })
  runtime.releaseRetryWait = input.routing.releaseRetryWait
  const accountForRequest = (options: GenerateOptions): string => input.routing.wireAccountFor(options, { routes: () => routes, modelsCompatible })

  const llm = ctx.get('llm')
  if (llm === undefined) return { world: undefined }
  const copilotCredentials = createCopilotCredentialsService(ctx.get('credentials'))

  const adapter = new EffortPinnedAdapter(
    {
      profiles: () => profiles,
      resolveApiKey: async provider => {
        const route = routes.get(provider)
        if (route === undefined) return undefined
        if (route.kind === CODEX_KIND) return undefined
        if (route.kind === GITHUB_COPILOT_KIND) return undefined
        if (route.kind === CLAUDE_KIND) {
          if (ClaudeAccountModel.usesCliTransport(route)) return CLAUDE_CLI_TOKEN
          try {
            return await claudeAccountService.resolveInferenceToken({
              configDir: route.configDir,
              keyEnv: route.apiKeyEnv,
              now: Date.now(),
              resolveCredential,
            })
          } catch (cause) {
            throw new LlmError(cause instanceof Error ? cause.message : `No Claude login for '${provider}'.`, 'MISSING_CREDENTIAL')
          }
        }
        // Keyed providers read the variable their own account names, so several
        // subscriptions live in the vault without any value in the accounts file.
        const named = ProviderRoutes.keyEnvFor(route)
        const namedKey = route.kind === COMMANDCODE_KIND ? await readCommandCodeKey(named, resolveCredential, route.authSource) : await resolveCredential(named)
        const key = route.authSource === undefined ? namedKey || config.opencodeApiKey.trim() : namedKey
        if (key.length === 0) {
          throw new LlmError(`No key for '${provider}'. Export ${named}, or set a shared key on the entry.`, 'MISSING_CREDENTIAL')
        }
        return key
      },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(attachments, hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath), ref),
      auth: {
        credentials: {
          read: async provider => {
            const route = routes.get(provider)
            if (route?.kind === GITHUB_COPILOT_KIND) return copilotCredentials.read(route.instanceId)
            if (route === undefined || route.kind !== CODEX_KIND) return undefined
            return CodexCredentialStore.forLayout(route.layout).read()
          },
          list: async () =>
            [...routes]
              .filter(([, route]) => route.kind === CODEX_KIND || route.kind === GITHUB_COPILOT_KIND)
              .map(([id]) => ({ providerId: id, type: 'oauth' as const })),
          modify: async (provider, mutate) => {
            const route = routes.get(provider)
            if (route?.kind === GITHUB_COPILOT_KIND) {
              return copilotCredentials.modify({
                instanceId: route.instanceId,
                mutate: async current => {
                  const next = await mutate(current)
                  if (next !== undefined && next.type !== 'oauth') throw new LlmError('GitHub Copilot uses OAuth credentials.', 'UNSUPPORTED_OPERATION')
                  return next
                },
              })
            }
            if (route === undefined || route.kind !== CODEX_KIND) {
              throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
            }
            return CodexCredentialStore.forLayout(route.layout).modify(mutate)
          },
          delete: async provider => {
            const route = routes.get(provider)
            if (route?.kind === GITHUB_COPILOT_KIND) {
              await copilotCredentials.remove(route.instanceId)
              return
            }
            throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
          },
        },
        authContext: {
          env: async () => undefined,
          fileExists: async () => false,
        },
      },
    },
    {
      reasoningDefaults,
      fastMode,
      routeFor: accountForRequest,
      declaredRetryAfter,
      imageRequestPricing: (provider, model) =>
        routes.get(provider)?.kind === COMMANDCODE_KIND ? CommandCodeCapabilities.imageRequestPricing(model) : undefined,
    },
  )

  runtime.modelCatalogForEditing = async instanceId => {
    const editingProfiles = buildProfiles(routes, await store.readAccountFile(), true)
    const catalogAdapter = new EffortPinnedAdapter(
      {
        profiles: () => editingProfiles,
        resolveApiKey: async () => undefined,
        auth: {
          credentials: { read: async () => undefined, list: async () => [], modify: async () => undefined, delete: async () => undefined },
          authContext: { env: async () => undefined, fileExists: async () => false },
        },
      },
      { reasoningDefaults: new Map(), fastMode },
    )
    const profile = editingProfiles.get(instanceId)
    const models = profile?.piProvider?.getModels() ?? []
    const nativeIds = profile === undefined ? new Set<string>() : ProviderProfileModel.nativeModelIdsForProfile(profile)
    const discoveredIds = new Set(catalogState.discovered(instanceId) ?? [])
    return Promise.all(
      models.map(async model => ({
        ...(await catalogAdapter.resolveModel(instanceId, model.id)),
        accountAdditional: !nativeIds.has(model.id) && !discoveredIds.has(model.id),
      })),
    )
  }

  let adapterRegistration: AdapterRegistrationHandle | undefined
  let directoryRegistration: DirectoryRegistrationHandle | undefined
  const modelDiscoveries = new Map<string, { readonly route: KeyedRoute; readonly dispose: () => void }>()

  const registerKeyedDiscovery = (id: string, route: KeyedRoute): void => {
    const dispose = llm.registerModelDiscovery(`ai-accounts.${route.kind}.${id}`, async (request, signal) => {
      if (route.kind === COMMANDCODE_KIND) {
        const entries = await fetchCommandCodeCatalog({
          ...CredentialModel.discoveryCatalogOptions(
            request,
            { apiBaseUrl: route.apiBaseUrl, keyEnv: ProviderRoutes.keyEnvFor(route) },
            await readCommandCodeKey(route.apiKeyEnv, resolveCredential, route.authSource),
          ),
          signal,
        })
        return entries.map(entry => ({
          id: entry.id,
          contextWindow: entry.contextWindow ?? 128_000,
          maxTokens: CommandCodeCapabilities.maxOutputTokens(entry.id),
          inputModalities: CommandCodeCapabilities.readsImages(entry.id) ? ['text', 'image'] : ['text'],
        }))
      }
      const modelIds = await fetchOpenCodeGoCatalog(signal)
      return modelIds.map(id => ({ id }))
    })
    modelDiscoveries.set(id, { route, dispose })
  }

  let registeredProviders: ReadonlySet<string> = new Set()
  const applyRouteSnapshot = (sourceFile: AccountStoreFile): void => {
    runtime.accountLogin?.reconcile(
      AccountLoginHostModel.accountsFromFile({ ...sourceFile, accounts: [...sourceFile.accounts, ...(runtime.accountSetup?.candidates() ?? [])] }),
    )
    const nextConfig = configFromAccountsFile(sourceFile)
    const takenProviders = new Set(
      llm
        .listProviders()
        .map(provider => provider.id)
        .filter(id => !registeredProviders.has(id)),
    )
    const { routes: nextRoutes, rejected } = ProviderRoutes.buildRoutes(nextConfig, { takenProviders })
    for (const reason of rejected) ctx.logger.warn(`ai-accounts: skipped account ${reason}`)
    runtime.rejectedRoutes = rejected
    const enabled = [...nextRoutes].filter(([, route]) => route.enabled)
    const providers = enabled.map(([id]) => id)
    const directoryEntries = enabled.map(([id, route]) => ({
      provider: id,
      displayName: route.displayName,
      settingsNs: `ai-accounts.${route.kind}.${id}`,
      settingsPath: [],
    }))

    if (adapterRegistration === undefined) {
      if (providers.length > 0) adapterRegistration = llm.registerAdapter(providers, adapter)
    } else {
      adapterRegistration.replace(providers)
    }
    registeredProviders = new Set(providers)
    if (directoryRegistration === undefined) {
      if (directoryEntries.length > 0) directoryRegistration = llm.registerConfigurableProviders(directoryEntries)
    } else {
      directoryRegistration.replace(directoryEntries)
    }

    for (const [id, registration] of modelDiscoveries) {
      if (sameKeyedRoute(nextRoutes.get(id), registration.route)) continue
      registration.dispose()
      modelDiscoveries.delete(id)
    }
    catalogState.retain(({ instanceId, route }) => sameKeyedRoute(nextRoutes.get(instanceId), route))
    for (const [id, route] of enabled) {
      if ((route.kind !== COMMANDCODE_KIND && route.kind !== OPENCODE_KIND) || modelDiscoveries.has(id)) continue
      registerKeyedDiscovery(id, route)
    }

    pool.replace([...nextRoutes].map(([id, route]) => ({ id, kind: route.kind, label: route.displayName, enabled: route.enabled })))
    pool.setDistribution(nextConfig.distribution)
    config = nextConfig
    routes = nextRoutes
    profiles = buildProfiles(nextRoutes, sourceFile)
    reasoningDefaults.clear()
    for (const [id, pins] of buildReasoningDefaults()) reasoningDefaults.set(id, pins)
    runtime.accounts = { config, pool }
  }

  applyRouteSnapshot(initialFile)
  let refreshQueue: Promise<void> = Promise.resolve()
  const refreshRoutes = (): Promise<void> => {
    const next = refreshQueue.then(async () => applyRouteSnapshot(await store.readAccountFile()))
    refreshQueue = next.catch(() => {
      ctx.logger.warn('ai-accounts: provider route refresh failed')
    })
    return next
  }
  runtime.refreshRoutes = refreshRoutes
  const refreshModelCatalog = async (instanceId: string): Promise<void> => {
    const route = routes.get(instanceId)
    if (route === undefined || !route.enabled || (route.kind !== COMMANDCODE_KIND && route.kind !== OPENCODE_KIND)) return
    const settingsNs = `ai-accounts.${route.kind}.${instanceId}`
    const discoveryRequest = route.kind === COMMANDCODE_KIND ? { provider: route.kind, baseURL: route.apiBaseUrl } : { provider: route.kind }
    const modelIds = await catalogState.refresh(instanceId, async signal =>
      (await llm.discoverModels(settingsNs, discoveryRequest, signal)).map(model => model.id),
    )
    // A route that changed while the fetch ran cannot claim the models it found.
    if (modelIds === undefined || !sameKeyedRoute(routes.get(instanceId), route)) return
    catalogState.record({ instanceId, route, modelIds })
    await refreshRoutes()
  }
  runtime.refreshModelCatalog = refreshModelCatalog
  // Discovered catalogs live in memory only, so without this every restart left
  // keyed accounts on their floor catalog until their model list was opened.
  for (const [instanceId, route] of routes) {
    if (!route.enabled || (route.kind !== COMMANDCODE_KIND && route.kind !== OPENCODE_KIND)) continue
    void refreshModelCatalog(instanceId).catch(() => ctx.logger.warn(`ai-accounts: startup catalog refresh failed for ${instanceId}`))
  }

  onRelease(() => {
    if (runtime.refreshRoutes === refreshRoutes) delete runtime.refreshRoutes
    if (runtime.refreshModelCatalog === refreshModelCatalog) delete runtime.refreshModelCatalog
    if (runtime.releaseRetryWait === input.routing.releaseRetryWait) delete runtime.releaseRetryWait
    for (const registration of modelDiscoveries.values()) registration.dispose()
    modelDiscoveries.clear()
  })
  const world: RoutingWorld = {
    routes: () => routes,
    offersModel: (provider, model) => modelForRoute(provider, model) !== undefined,
    modelsCompatible,
    nativeProviders: () => llm.listProviders().map(provider => provider.id),
    fallbackRouter,
    recovery,
    servingAccount,
    recordQuotaFailure: RequestRoutingHooks.recordQuotaFailure(quotaContinuations),
    selectModel: RequestRoutingHooks.selectModel(ctx),
  }
  return { world }
}

const AccountsHostLive = Layer.effectDiscard(
  Effect.gen(function* () {
    const host = yield* HostContext
    const accountSettings = yield* AccountSettings
    const store = yield* AccountStorePromiseService
    const pool = yield* AccountPool
    const routing = yield* RequestRouting
    const services = yield* DshxPlugin.detachedContext<never>()
    const usage = UsageSnapshotPromiseModel.facade(yield* UsageSnapshot, services)
    const usageHistory = UsageHistoryPromiseModel.facade(yield* UsageHistorySchedule, services)
    const modelCatalogs = ModelCatalogsPromiseModel.facade(yield* ModelCatalogs, services)
    const pricingService = yield* PricingCatalog
    const pricing = PricingCatalogPromiseModel.facade(pricingService, services)
    // The imperative Host reads preferences synchronously; this mirror follows every committed change.
    const live = { settings: yield* accountSettings.current }
    yield* DshxPlugin.worker(
      Stream.runForEach(accountSettings.changes, next =>
        Effect.sync(() => {
          live.settings = next
        }),
      ),
    )
    const activation = yield* Effect.acquireRelease(
      Effect.sync(() => {
        const releases: Array<() => void> = []
        return {
          started: startAccountsHost({
            ctx: host.ctx,
            readSettings: () => live.settings,
            store,
            pool,
            routing,
            usage,
            usageHistory,
            pricing,
            modelCatalogs,
            onRelease: release => releases.push(release),
          }),
          releases,
        }
      }),
      activation =>
        Effect.sync(() => {
          for (const release of activation.releases.toReversed()) release()
        }),
    )
    if (activation.started.world !== undefined) yield* routing.install(activation.started.world)
  }),
)

/** The pool starts with every saved account route, with the distribution and cooldown the accounts file names. */
const AccountPoolLive = Layer.unwrap(
  Effect.gen(function* () {
    const store = yield* AccountStore
    const config = configFromAccountsFile(yield* SubscriptionRef.get(store.snapshot))
    const accounts = [...ProviderRoutes.buildRoutes(config).routes].map(([id, route]) => ({
      id,
      kind: route.kind,
      label: route.displayName,
      enabled: route.enabled,
    }))
    return AccountPool.layer({ distribution: config.distribution, cooldownMs: config.cooldownMs, accounts })
  }),
)

export default DshxPlugin.make({
  name: 'llm-ai-accounts',
  inject: ['llm', 'connection', 'webServer', 'storageDomain', 'sessionController', 'workspaceRegistry', 'credentials', 'agents', 'sessionProjections'],
  settings: [aiAccountsSettings],
  layer: Layer.merge(AccountsHostLive, QuotaAttention.layer.pipe(Layer.provide(HostApis.layer))).pipe(
    Layer.provideMerge(
      Layer.mergeAll(
        RequestRouting.layer,
        UsageSnapshotPromiseModel.layer,
        UsageHistoryPromiseModel.layer,
        PricingCatalog.scheduled().pipe(Layer.provideMerge(PricingCatalog.layer({ path: DEFAULT_PRICING_PATH }))),
        ModelCatalogs.layer,
      ).pipe(
        Layer.provideMerge(AccountPoolLive),
        Layer.provideMerge(
          Layer.mergeAll(AccountLocks.layer, AccountSettings.layer, AccountStorePromiseService.layer.pipe(Layer.provideMerge(AccountStore.layer))),
        ),
        Layer.provideMerge(AccountsPlatformLive),
      ),
    ),
  ),
  apis: [accountsHostApi, modelFallbackHostApi, modelFastModeHostApi, servingAccountHostApi, accountLoginHostApi, accountSessionHostApi, threadAccountHostApi],
  tools: [aiAccountsTool],
})
