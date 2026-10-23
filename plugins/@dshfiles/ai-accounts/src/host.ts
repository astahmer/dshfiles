import { activateAccountRuntime } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
export { Config } from './account-config.js'
// Brings in the CSS-module declarations a plugin would otherwise restate.
import type {} from '@dshfiles/dshx/client'
import { AccountsHostApiModel, accountsHostApi } from './accounts-host-api.js'
import { closeModelFallbacks, modelFallbackHostApi, modelFallbacksFor } from './model-fallback-host.js'
import { createModelFallbackRouter } from './model-fallback-router.js'
import { ModelFallbackModel } from './model-fallback.js'
import type { ModelFallbackStore } from './model-fallback-store.js'
import type { FallbackRoute } from './model-fallback-api.js'
import { createUsageCache } from './account-usage.js'
import { createCopilotLoginService } from './copilot-login.js'
import { ClaudeAccountModel, claudeAccountService } from './claude-account.js'
import { CLAUDE_CLI_TOKEN, ClaudeCliSessions } from './claude-cli.js'
import { readCommandCodeKey } from './commandcode-usage.js'
import { AccountSettingsModel, aiAccountsHostSettings } from './settings.js'
import { shouldUseLunaReserve, withLunaReserve } from './codex-luna-reserve.js'
import { FastModeService, isCodexFastModeModel, withCodexFastMode } from './codex-fast-mode.js'
import { createFastModeUsageHistoryService } from './fast-mode-usage-history.js'
import { modelFastModeHostApi } from './model-fast-mode-host.js'
import { createPricingCatalog, DEFAULT_PRICING_PATH } from './pricing-catalog.js'
import { installCostProjection } from './cost-projection.js'
import { accountStoreService, type AccountStoreFile } from './account-store.js'
import { aiAccountsTool } from './accounts-tool.js'
import { createUsageHistoryService } from './usage-recorder.js'
import { CommandCodeCapabilities } from './commandcode-capabilities.js'
import { fetchCommandCodeCatalog, createCommandCodeProvider } from './commandcode-provider.js'
import { CredentialModel, resolveKeyFromContext } from './credentials.js'
import { fetchOpenCodeGoCatalog } from './opencode-go-catalog.js'
import { definePlugin } from '@dshfiles/dshx/host'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { anthropicProvider } from '@earendil-works/pi-ai/providers/anthropic'
import { createProvider } from '@earendil-works/pi-ai'
import { githubCopilotProvider } from '@earendil-works/pi-ai/providers/github-copilot'
import { createCopilotCredentialsService } from './copilot-credentials.js'
import { GITHUB_COPILOT_KIND } from './provider-routes.js'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
// Value imports, not `import type {}`: an empty type-only import is elided and
// never loads the package's cordis module augmentation, which is what makes
// `ctx.on('llm/stream')` and the agent-scoped listeners typecheck here.
import { LlmError, ReasoningEffortId, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createAccountPool, creditServedAttempt } from './account-pool.js'
import { explainSilentRejections } from './silent-rejection.js'
import { FailureRecoveryModel } from './failure-recovery.js'
import { isRetryId, retryNotice } from './retry-notice.js'
import { RequestAccountRouting } from './request-account-routing.js'
// Types the `llm/retry` rows this plugin writes, so a fail-over shows in the turn like DSH's own retries.
import type { LlmRetryEventData, LlmRetryStartedEventData } from '@deepseek-ai/dsh-llm-retry'
import type {} from '@dshfiles/request-messages'
declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'llm/retry': LlmRetryEventData
    'llm/retry-started': LlmRetryStartedEventData
  }
}
import { randomUUID } from 'node:crypto'
import { materializeCodexShadowHome } from './codex-home.js'
import { readCodexAccessToken } from './read-codex-token.js'
import { persistCodexOAuthCredential, readCodexOAuthCredential } from './codex-credential.js'
import { createQuotaContinuationService } from './quota-continuation.js'
import { buildProfile, EffortPinnedAdapter } from './provider-profile.js'
import { CLAUDE_KIND, COMMANDCODE_KIND, CODEX_KIND, OPENCODE_KIND, ProviderRoutes, type KeyedRoute, type Route } from './provider-routes.js'
export { CODEX_KIND, OPENCODE_KIND, COMMANDCODE_KIND, CLAUDE_KIND } from './provider-routes.js'

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

const HOUR_MS = 3_600_000
/** A Luna Reserve switch outlives a stale usage card for this long, then the card decides again. */
const LUNA_RESERVE_HOLD_MS = 60 * 60_000
/** The refresh period is in hours; checking twice an hour keeps a lowered setting honest. */
const PRICING_CHECK_MS = 30 * 60_000

export default definePlugin({
  id: 'llm-ai-accounts',
  inject: ['llm', 'connection', 'webServer', 'storageDomain', 'sessionController', 'credentials', 'agents'],
  apis: [accountsHostApi, modelFallbackHostApi, modelFastModeHostApi],
  tools: [aiAccountsTool],
  settings: [aiAccountsHostSettings],
  setup: api => {
    const ctx = api.raw.ctx
    const resolveCredential = resolveKeyFromContext(ctx)
    const runtime = activateAccountRuntime(ctx)
    const usageHistory = createUsageHistoryService(ctx)
    const fastModeUsageHistory = createFastModeUsageHistoryService(ctx, {
      readRetentionDays: async () => (await usageHistory.readSettings()).retentionDays,
    })
    runtime.fastModeUsageHistory = fastModeUsageHistory
    runtime.scheduler = usageHistory.createScheduler(
      async () => {
        const file = await AccountsHostApiModel.accountsFile(ctx)
        return { accounts: file.accounts, shadowRoot: file.shadowRoot }
      },
      { resolveCredential },
    )
    // 30 s: long enough that the page, footer and edge overlay share one sweep,
    // short enough that a manual reload still feels live.
    ctx.effect(() => () => {
      runtime.scheduler?.dispose()
      if (runtime.fastModeUsageHistory === fastModeUsageHistory) delete runtime.fastModeUsageHistory
      void usageHistory.close().catch(() => ctx.logger.warn('ai-accounts: usage history storage could not close cleanly'))
      void fastModeUsageHistory.close().catch(() => ctx.logger.warn('ai-accounts: Fast mode usage storage could not close cleanly'))
    })
    runtime.usageCache = createUsageCache({ ttlMs: 30_000, read: () => AccountsHostApiModel.readAccountsUsage(ctx) })
    ctx.on('credentials/reference-updated', ref => {
      if (accountStoreService.readAccountFileSync().accounts.some(account => account.apiKeyEnv === ref)) runtime.usageCache?.invalidate()
    })
    const pricing = createPricingCatalog({ path: DEFAULT_PRICING_PATH })
    runtime.pricing = pricing
    const refreshStalePricing = (): void => {
      const settings = AccountSettingsModel.readPricingSettings()
      if (settings.costEstimates) void pricing.ensureFresh(settings.pricingRefreshHours * HOUR_MS)
    }
    ctx.effect(() => {
      void pricing.load().then(refreshStalePricing)
      const timer = setInterval(refreshStalePricing, PRICING_CHECK_MS)
      return () => {
        clearInterval(timer)
        if (runtime.pricing === pricing) delete runtime.pricing
      }
    })
    installCostProjection(ctx)
    let fallbackStore: ModelFallbackStore | undefined
    ctx.effect(() => {
      void modelFallbacksFor(ctx)
        .then(store => {
          fallbackStore = store
        })
        .catch(() => ctx.logger.warn('ai-accounts: model fallback storage could not open; threads keep account-level fail-over'))
      return () => {
        void closeModelFallbacks().catch(() => ctx.logger.warn('ai-accounts: model fallback storage could not close cleanly'))
      }
    })
    const quotaContinuations = createQuotaContinuationService({ context: ctx, readResetAt: accountId => AccountsHostApiModel.readQuotaResetAt(ctx, accountId) })
    runtime.quotaContinuations = quotaContinuations
    ctx.effect(() => {
      const stopQuotaContinuations = quotaContinuations.start()
      return () => {
        stopQuotaContinuations()
        if (runtime.quotaContinuations === quotaContinuations) delete runtime.quotaContinuations
        void quotaContinuations.close().catch(() => ctx.logger.warn('ai-accounts: quota recovery storage could not close cleanly'))
      }
    })
    // Cordis activates this plugin synchronously, so the cache must hold the file
    // before the first read: an unprimed cache answers emptyFile(), which
    // registers no routes at all and hides the whole page.
    accountStoreService.primeAccountFile()
    const initialFile = accountStoreService.readAccountFileSync()
    let config = configFromAccountsFile(initialFile)
    let routes = ProviderRoutes.buildRoutes(config).routes
    let profiles = new Map<string, ResolvedPiAiProviderProfile>()
    const fastMode = new FastModeService({
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
      isCopilotAccount: instanceId => routes.get(instanceId)?.kind === GITHUB_COPILOT_KIND,
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
    ctx.effect(() => () => claudeCli.dispose(), 'ai-accounts: claude cli processes')
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
    /** Codex accounts a quota failure sent to Luna Reserve ahead of their usage card, until this time. */
    const lunaReserveHolds = new Map<string, number>()
    const lunaReserveHeld = (id: string, now: number): boolean => (lunaReserveHolds.get(id) ?? 0) > now
    const discoveredModelIds = new Map<string, { readonly route: KeyedRoute; readonly modelIds: readonly string[] }>()
    const modelCatalogRefreshes = new Map<string, { readonly route: KeyedRoute; readonly controller: AbortController }>()
    const sameKeyedRoute = (candidate: Route | undefined, expected: KeyedRoute): boolean => {
      if (candidate === undefined || !candidate.enabled) return false
      if (expected.kind === COMMANDCODE_KIND) {
        return candidate.kind === COMMANDCODE_KIND && candidate.apiBaseUrl === expected.apiBaseUrl && candidate.apiKeyEnv === expected.apiKeyEnv
      }
      return candidate.kind === OPENCODE_KIND && candidate.apiBaseUrl === expected.apiBaseUrl && candidate.apiKeyEnv === expected.apiKeyEnv
    }
    // Each keyed provider is built with its own base and key variable, so two
    // Command Code accounts can point at different deployments.
    const keyedUpstream = (route: KeyedRoute) =>
      route.kind === COMMANDCODE_KIND
        ? createCommandCodeProvider({
            baseUrl: route.apiBaseUrl,
            keyEnv: route.apiKeyEnv,
            resolveCredential,
            readFallbackKey: () => readCommandCodeKey(route.apiKeyEnv, resolveCredential),
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
    const buildProfiles = (nextRoutes: ReadonlyMap<string, Route>, sourceFile: AccountStoreFile): Map<string, ResolvedPiAiProviderProfile> => {
      const enabled = [...nextRoutes].filter(([, route]) => route.enabled)
      const curation = sourceFile.accounts.map(
        account =>
          [
            account.instanceId,
            {
              hiddenModelIds: account.hiddenModelIds,
              favoriteModelIds: account.favoriteModelIds,
              modelOrder: account.modelOrder,
            },
          ] as const,
      )
      const reasoningPins = sourceFile.accounts.map(
        account =>
          [
            account.instanceId,
            typeof account.reasoningDefaults === 'object' && account.reasoningDefaults !== null ? (account.reasoningDefaults as Record<string, string>) : {},
          ] as const,
      )

      const upstreamFor = (id: string, route: Route) => {
        if (route.kind === CODEX_KIND) {
          return withLunaReserve({
            upstream: codexFastUpstream,
            onReserve: () =>
              AccountSettingsModel.readLunaReserveRouting() &&
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
          buildProfile({
            upstream: upstreamFor(id, route),
            provider: id,
            displayName: route.displayName,
            reasoningDefaults: reasoningPins.find(([instanceId]) => instanceId === id)?.[1],
            ...(curation.find(([instanceId]) => instanceId === id)?.[1] ?? {}),
            additionalModelIds: [
              ...(sourceFile.accounts.find(account => ProviderRoutes.normalizeInstanceId(account.instanceId, account.kind) === id)?.additionalModelIds ?? []),
              ...(discoveredModelIds.get(id)?.modelIds ?? []),
            ],
          }),
        ]),
      )
    }

    const buildReasoningDefaults = (sourceFile: AccountStoreFile): Map<string, Readonly<Record<string, string>>> =>
      new Map(
        sourceFile.accounts.map(
          account =>
            [
              account.instanceId,
              typeof account.reasoningDefaults === 'object' && account.reasoningDefaults !== null ? (account.reasoningDefaults as Record<string, string>) : {},
            ] as const,
        ),
      )

    profiles = buildProfiles(routes, initialFile)
    const reasoningDefaults = buildReasoningDefaults(initialFile)

    const pool = createAccountPool({
      distribution: config.distribution,
      cooldownMs: config.cooldownMs,
    })
    runtime.accounts = { config, pool }
    for (const [id, route] of routes) {
      pool.put({ id, kind: route.kind, label: route.displayName, enabled: route.enabled })
    }

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
      const settings = AccountSettingsModel.readRecoverySettings()
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
    ctx.effect(() => () => {
      if (runtime.modelFallbackRouter === fallbackRouter) delete runtime.modelFallbackRouter
    })
    const recovery = FailureRecoveryModel.create({
      pool,
      isAccountRoute: provider => routes.has(provider),
      readPolicy: () => AccountSettingsModel.readRecoverySettings().policy,
      failoverCandidates: ({ from, model }) => {
        const settings = AccountSettingsModel.readRecoverySettings()
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
          if (routes.get(id)?.kind !== CODEX_KIND || !AccountSettingsModel.readLunaReserveRouting()) return false
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
    const activeAccountRoutes = new Map<
      string,
      {
        readonly turn: number
        readonly step: number
        readonly provider: string
        readonly model: string
        accountId: string
      }
    >()
    const accountForRequest = (options: GenerateOptions): string =>
      RequestAccountRouting.wireAccountFor({
        provider: options.provider,
        model: options.model,
        purpose: options.purpose,
        conversationKey: options.sessionId,
        active: options.sessionId === undefined ? undefined : activeAccountRoutes.get(options.sessionId),
        routes,
        pool,
        modelsCompatible,
      })

    const llm = ctx.get('llm')
    if (llm === undefined) return
    const copilotCredentials = createCopilotCredentialsService(ctx.get('credentials'))

    const adapter = new EffortPinnedAdapter(
      {
        profiles: () => profiles,
        resolveApiKey: async provider => {
          const route = routes.get(provider)
          if (route === undefined) return undefined
          if (route.kind === CODEX_KIND) {
            await materializeCodexShadowHome(route.layout)
            return readCodexAccessToken(route.layout.effectiveHomePath)
          }
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
          const namedKey = route.kind === COMMANDCODE_KIND ? await readCommandCodeKey(named, resolveCredential) : await resolveCredential(named)
          const key = namedKey || config.opencodeApiKey.trim()
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
              await materializeCodexShadowHome(route.layout)
              return readCodexOAuthCredential(route.layout.effectiveHomePath)
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
              await materializeCodexShadowHome(route.layout)
              const codexHome = route.layout.effectiveHomePath
              const next = await mutate(await readCodexOAuthCredential(codexHome))
              if (next !== undefined && next.type === 'oauth') await persistCodexOAuthCredential(codexHome, next)
              return next
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
        imageRequestPricing: (provider, model) =>
          routes.get(provider)?.kind === COMMANDCODE_KIND ? CommandCodeCapabilities.imageRequestPricing(model) : undefined,
      },
    )

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
              await readCommandCodeKey(route.apiKeyEnv, resolveCredential),
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
      for (const [id, refresh] of modelCatalogRefreshes) {
        if (sameKeyedRoute(nextRoutes.get(id), refresh.route)) continue
        refresh.controller.abort()
        modelCatalogRefreshes.delete(id)
      }
      for (const [id, catalog] of discoveredModelIds) {
        if (sameKeyedRoute(nextRoutes.get(id), catalog.route)) continue
        discoveredModelIds.delete(id)
      }
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
      for (const [id, pins] of buildReasoningDefaults(sourceFile)) reasoningDefaults.set(id, pins)
      runtime.accounts = { config, pool }
    }

    applyRouteSnapshot(initialFile)
    let refreshQueue: Promise<void> = Promise.resolve()
    const refreshRoutes = (): Promise<void> => {
      const next = refreshQueue.then(async () => applyRouteSnapshot(await accountStoreService.readAccountFile()))
      refreshQueue = next.catch(() => {
        ctx.logger.warn('ai-accounts: provider route refresh failed')
      })
      return next
    }
    runtime.refreshRoutes = refreshRoutes
    const refreshModelCatalog = async (instanceId: string): Promise<void> => {
      const route = routes.get(instanceId)
      if (route === undefined || !route.enabled || (route.kind !== COMMANDCODE_KIND && route.kind !== OPENCODE_KIND)) return
      modelCatalogRefreshes.get(instanceId)?.controller.abort()
      const refresh = { route, controller: new AbortController() }
      modelCatalogRefreshes.set(instanceId, refresh)
      try {
        const settingsNs = `ai-accounts.${route.kind}.${instanceId}`
        const discoveryRequest = route.kind === COMMANDCODE_KIND ? { provider: route.kind, baseURL: route.apiBaseUrl } : { provider: route.kind }
        const signal = AbortSignal.any([refresh.controller.signal, AbortSignal.timeout(15_000)])
        const discovered = await llm.discoverModels(settingsNs, discoveryRequest, signal)
        if (modelCatalogRefreshes.get(instanceId) !== refresh || !sameKeyedRoute(routes.get(instanceId), route)) return
        discoveredModelIds.set(instanceId, { route, modelIds: discovered.map(model => model.id) })
        await refreshRoutes()
      } finally {
        if (modelCatalogRefreshes.get(instanceId) === refresh) modelCatalogRefreshes.delete(instanceId)
      }
    }
    runtime.refreshModelCatalog = refreshModelCatalog
    // Discovered catalogs live in memory only, so without this every restart left
    // keyed accounts on their floor catalog until their model list was opened.
    for (const [instanceId, route] of routes) {
      if (!route.enabled || (route.kind !== COMMANDCODE_KIND && route.kind !== OPENCODE_KIND)) continue
      void refreshModelCatalog(instanceId).catch(() => ctx.logger.warn(`ai-accounts: startup catalog refresh failed for ${instanceId}`))
    }

    const disposers: Array<() => void> = []

    ctx.effect(() => {
      disposers.push(
        ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
          // Credited only after the upstream answers, so a failed attempt is never "used",
          // and to the account a fail-over put on the wire rather than the chosen route.
          if (!routes.has(options.provider)) return next()
          return explainSilentRejections(creditServedAttempt(next(), { pool, accountId: accountForRequest(options) }), options)
        }),
      )

      // Per-agent listeners live on the agent's own context so they unwind with
      // the agent. This plugin also keeps their disposers, so unloading the
      // plugin releases every agent registration it owns.
      const perAgent = new Map<string, () => void>()
      disposers.push(
        ctx.on('agent/created', async payload => {
          const agent = payload.agent
          const id = agent.id
          perAgent.get(id)?.()
          const dispose = agent.ctx.effect(() => {
            // Wrap later request selectors so routing sees their final logical provider and model.
            const offRequest = agent.ctx.on(
              'agent/request',
              async ({ turn, step }, next) => {
                const proposed = await next()
                const fallback = fallbackRouter.routeRequest({ sessionId: id, turn, request: proposed })
                let request: typeof proposed = proposed
                if (fallback !== undefined) {
                  // The proposed effort belongs to the route the fallback replaces.
                  const { reasoningEffort: _replacedEffort, ...proposedRest } = proposed
                  request = { ...proposedRest, provider: fallback.provider, model: fallback.model }
                  if (fallback.reasoningEffort !== undefined) request = { ...request, reasoningEffort: ReasoningEffortId(fallback.reasoningEffort) }
                }
                const preflight = RequestAccountRouting.selectionPreflight({
                  provider: request.provider,
                  model: request.model,
                  routes,
                  nativeProviders: (llm?.listProviders() ?? []).map(provider => provider.id),
                  offersModel: (provider, model) => modelForRoute(provider, model) !== undefined,
                  pool,
                })
                if (preflight.kind === 'unserved') throw RequestAccountRouting.unservedProviderError(request.provider)
                if (preflight.kind === 'route') {
                  ctx.logger.warn(
                    `ai-accounts: selection names provider "${request.provider}" with no adapter; serving this request from ${preflight.provider}`,
                  )
                  request = { ...request, provider: preflight.provider }
                }
                if (!routes.has(request.provider)) {
                  activeAccountRoutes.delete(id)
                  return request
                }
                const distribution = pool.distribution()
                if (distribution !== 'sticky') pool.bindRoute(id, request.provider, request.provider)
                const recoverySettings = AccountSettingsModel.readRecoverySettings()
                // A fallback chain is the whole fail-over order, so its routes are not spread across accounts.
                const accountId = RequestAccountRouting.selectTurnAccount({
                  provider: request.provider,
                  model: request.model,
                  conversationKey: id,
                  routes,
                  pool,
                  modelsCompatible,
                  chainWalking: fallbackRouter.walksChain(id),
                  usageOrder: recoverySettings.usageOrder,
                  hiddenAccountIds: recoverySettings.hiddenUsageAccounts,
                })
                activeAccountRoutes.set(id, { turn, step, provider: request.provider, model: request.model, accountId })
                return request
              },
              { prepend: true },
            )
            const offTurnStopping = agent.ctx.on('agent/turn-stopping', () => {
              activeAccountRoutes.delete(id)
              const restored = fallbackRouter.turnEnded(id)
              if (restored === undefined) return
              void ctx
                .get('sessionController')
                ?.selectModel({ sessionId: agent.session.id, ...ModelFallbackModel.selectionFor(restored) })
                .catch((error: unknown) =>
                  ctx.logger.warn(`ai-accounts: thread stayed on its fallback instead of returning to ${restored.provider}: ${String(error)}`),
                )
            })
            const offRequestMessages = agent.ctx.on('agent/request-messages', async ({ turn, step }, next) => {
              const messages = await next()
              return recovery.shrinkActive(id, turn, step) ? FailureRecoveryModel.offloadResentImages(messages) : messages
            })
            // Prepended so the account policy decides before DSH's provider-wide retry,
            // which would otherwise spend its retries on an account that is already spent.
            const offRequestError = agent.ctx.on(
              'agent/request-error',
              async ({ turn, step, provider, failure, signal }, next) => {
                const surface = agent.session.deriveMessages()
                const active = activeAccountRoutes.get(id)
                const routedAccountId = active?.turn === turn && active.step === step && active.provider === provider ? active.accountId : undefined
                const requestProvider = agent.session.requestHeader()?.config.provider ?? provider
                const action = recovery.recover({
                  conversationKey: id,
                  turn,
                  step,
                  provider,
                  requestProvider,
                  ...(routedAccountId === undefined ? {} : { routedAccountId }),
                  model: agent.session.requestHeader()?.config.model,
                  failure,
                  canShrink: FailureRecoveryModel.offloadResentImages(surface) !== surface,
                })
                if (
                  action.kind === 'retry' &&
                  action.step.kind === 'failover' &&
                  routes.has(action.step.to) &&
                  routedAccountId !== undefined &&
                  active !== undefined
                ) {
                  active.accountId = action.step.to
                }
                if (action.kind === 'pass') return next()
                if (action.kind === 'give-up') {
                  const decision = action.then === 'dsh' ? await next() : undefined
                  const requestConfig = agent.session.requestHeader()?.config
                  const failedSelection = requestConfig === undefined ? undefined : { provider: requestConfig.provider, model: requestConfig.model }
                  const recovery = FailureRecoveryModel.quotaRecoveryFor({
                    failureKind: action.failureKind,
                    rescued: decision !== undefined,
                    autoRetryDefault: AccountSettingsModel.readQuotaRetrySettings().autoRetryDefault,
                  })
                  if (recovery !== undefined) {
                    await quotaContinuations.recordFailure(agent, action.account, recovery.autoRetry, failedSelection, failure.message)
                  }
                  return decision
                }
                const retryId = action.retryId
                if (!isRetryId(retryId)) return next()
                const notice = retryNotice(action, {
                  retryId,
                  turn,
                  step,
                  provider: requestProvider,
                  failure,
                  label: target => {
                    // Chain targets are `provider/model`; account ids never hold a slash.
                    const slash = target.indexOf('/')
                    const provider = slash < 0 ? target : target.slice(0, slash)
                    const name = routes.get(provider)?.displayName ?? provider
                    return slash < 0 ? name : `${name} · ${target.slice(slash + 1)}`
                  },
                })
                ctx.logger.info(`ai-accounts: ${notice.failure.message}`)
                agent.session.append('llm/retry', notice)
                const delayMs = action.step.kind === 'retry' || action.step.kind === 'wait' ? action.step.delayMs : 0
                if (!(await cancellableDelay(delayMs, signal))) return undefined
                agent.session.append('llm/retry-started', { retryId: notice.retryId, turn, step, retry: notice.retry })
                // The retry re-reads the Session selection, so it opens on the stand-in route and the picker follows.
                const followed =
                  action.step.kind === 'failover' && !routes.has(action.step.to)
                    ? chainSelection(fallbackRouter.active(id))
                    : FailureRecoveryModel.selectionAfter({ action, config: agent.session.requestHeader()?.config })
                if (followed !== undefined) {
                  await ctx
                    .get('sessionController')
                    ?.selectModel({ sessionId: agent.session.id, ...followed })
                    .catch((error: unknown) =>
                      ctx.logger.warn(`ai-accounts: picker kept ${requestProvider} after failing over to ${followed.provider}: ${String(error)}`),
                    )
                }
                return { kind: 'retry' }
              },
              { prepend: true },
            )
            agent.ctx.on('agent/disposed', () => {
              activeAccountRoutes.delete(id)
              recovery.forget(id)
              fallbackRouter.forget(id)
            })
            return () => {
              activeAccountRoutes.delete(id)
              offRequest()
              offTurnStopping()
              offRequestError()
              offRequestMessages()
            }
          })
          perAgent.set(id, () => {
            dispose()
            perAgent.delete(id)
          })
        }),
      )
      disposers.push(
        ctx.on('agent/disposed', payload => {
          perAgent.get(payload.agent.id)?.()
        }),
      )

      return () => {
        if (runtime.refreshRoutes === refreshRoutes) delete runtime.refreshRoutes
        if (runtime.refreshModelCatalog === refreshModelCatalog) delete runtime.refreshModelCatalog
        for (const refresh of modelCatalogRefreshes.values()) refresh.controller.abort()
        modelCatalogRefreshes.clear()
        discoveredModelIds.clear()
        for (const registration of modelDiscoveries.values()) registration.dispose()
        modelDiscoveries.clear()
        for (const dispose of disposers) dispose()
        for (const dispose of perAgent.values()) dispose()
        perAgent.clear()
      }
    })
  },
})

const chainSelection = (route: FallbackRoute | undefined) => (route === undefined ? undefined : ModelFallbackModel.selectionFor(route))

const cancellableDelay = (delayMs: number, signal: AbortSignal): Promise<boolean> => {
  if (signal.aborted) return Promise.resolve(false)
  if (delayMs <= 0) return Promise.resolve(true)
  return new Promise(resolve => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve(true)
    }, delayMs)
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
