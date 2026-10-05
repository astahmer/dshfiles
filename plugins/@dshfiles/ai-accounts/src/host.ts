import { activateAccountRuntime } from './account-runtime.js'
import { configFromAccountsFile } from './account-config.js'
export { Config } from './account-config.js'
// Brings in the CSS-module declarations a plugin would otherwise restate.
import type {} from '@dshfiles/dshx/client'
import { accountsFile, accountsHostApi } from './accounts-host-api.js'
export { accountsSnapshot } from './accounts-host-api.js'
import { primeAccountFile, readAccountFile, readAccountFileSync } from './account-store.js'
import { aiAccountsTool } from './accounts-tool.js'
import { createUsageHistoryScheduler } from './usage-recorder.js'
import { fetchCommandCodeCatalog, createCommandCodeProvider } from './commandcode-provider.js'
import { discoveryCatalogOptions, readKeyFromEnv } from './credentials.js'
import { definePlugin } from '@dshfiles/dshx/host'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
// Value imports, not `import type {}`: an empty type-only import is elided and
// never loads the package's cordis module augmentation, which is what makes
// `ctx.on('llm/stream')` and the agent-scoped listeners typecheck here.
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { createAccountPool, isRateLimitFailure } from './account-pool.js'
import { materializeCodexShadowHome } from './codex-home.js'
import { readCodexAccessToken } from './read-codex-token.js'
import { persistCodexOAuthCredential, readCodexOAuthCredential } from './codex-credential.js'
import { buildProfile, EffortPinnedAdapter } from './provider-profile.js'
import { COMMANDCODE_KIND, CODEX_KIND, buildRoutes, keyEnvFor, normalizeInstanceId, type KeyedRoute } from './provider-routes.js'
export { CODEX_KIND, OPENCODE_KIND, COMMANDCODE_KIND } from './provider-routes.js'

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

export default definePlugin({
  id: 'llm-ai-accounts',
  inject: ['llm', 'connection', 'webServer', 'storageDomain'],
  apis: [accountsHostApi],
  tools: [aiAccountsTool],
  setup: api => {
    const ctx = api.raw.ctx
    const runtime = activateAccountRuntime(ctx)
    runtime.scheduler = createUsageHistoryScheduler(ctx, async () => (await accountsFile(ctx)).accounts)
    // Cordis activates this plugin synchronously, so the cache must hold the file
    // before the first read: an unprimed cache answers emptyFile(), which
    // registers no routes at all and hides the whole page.
    primeAccountFile()
    const initialFile = readAccountFileSync()
    let config = configFromAccountsFile(initialFile)
    let routes = buildRoutes(config).routes

    const codexUpstream = openaiCodexProvider()
    const opencodeUpstream = opencodeGoProvider()
    // Each keyed provider is built with its own base and key variable, so two
    // Command Code accounts can point at different deployments.
    const keyedUpstream = (route: KeyedRoute) =>
      route.kind === COMMANDCODE_KIND
        ? createCommandCodeProvider({
            baseUrl: route.apiBaseUrl,
            keyEnv: route.apiKeyEnv,
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
      nextConfig: typeof config,
      nextRoutes: ReadonlyMap<string, Route>,
      sourceFile: ReturnType<typeof readAccountFileSync>,
    ): Map<string, ResolvedPiAiProviderProfile> => {
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

      return new Map<string, ResolvedPiAiProviderProfile>(
        enabled.map(([id, route]) => [
          id,
          buildProfile({
            upstream: route.kind === CODEX_KIND ? codexUpstream : keyedUpstream(route),
            provider: id,
            displayName: route.displayName,
            reasoningDefaults: reasoningPins.find(([instanceId]) => instanceId === id)?.[1],
            ...(curation.find(([instanceId]) => instanceId === id)?.[1] ?? {}),
            additionalModelIds:
              route.kind === CODEX_KIND
                ? (nextConfig.codexAccounts.find(account => normalizeInstanceId(account.instanceId, CODEX_KIND) === id)?.additionalModelIds ?? [])
                : [],
          }),
        ]),
      )
    }

    const buildReasoningDefaults = (
      sourceFile: ReturnType<typeof readAccountFileSync>,
    ): Map<string, Readonly<Record<string, string>>> =>
      new Map(
        sourceFile.accounts.map(
          account =>
            [
              account.instanceId,
              typeof account.reasoningDefaults === 'object' && account.reasoningDefaults !== null
                ? (account.reasoningDefaults as Record<string, string>)
                : {},
            ] as const,
        ),
      )

    let profiles = buildProfiles(config, routes, initialFile)
    const reasoningDefaults = buildReasoningDefaults(initialFile)

    const pool = createAccountPool({
      distribution: config.distribution,
      cooldownMs: config.cooldownMs,
    })
    runtime.accounts = { config, pool }
    for (const [id, route] of routes) {
      pool.put({ id, kind: route.kind, label: route.displayName, enabled: route.enabled })
    }

    const llm = ctx.get('llm')
    if (llm === undefined) return

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
          // Keyed providers read the variable their own account names, so several
          // subscriptions live in the vault without any value in the accounts file.
          const named = keyEnvFor(route)
          const sharedKey = route.kind === COMMANDCODE_KIND ? '' : config.opencodeApiKey.trim()
          const key = readKeyFromEnv(named) || sharedKey
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
              if (route === undefined || route.kind !== CODEX_KIND) return undefined
              await materializeCodexShadowHome(route.layout)
              return readCodexOAuthCredential(route.layout.effectiveHomePath)
            },
            list: async () => [...routes].filter(([, route]) => route.kind === CODEX_KIND).map(([id]) => ({ providerId: id, type: 'oauth' as const })),
            modify: async (provider, mutate) => {
              const route = routes.get(provider)
              if (route === undefined || route.kind !== CODEX_KIND) {
                throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
              }
              await materializeCodexShadowHome(route.layout)
              const codexHome = route.layout.effectiveHomePath
              const next = await mutate(await readCodexOAuthCredential(codexHome))
              if (next !== undefined && next.type === 'oauth') await persistCodexOAuthCredential(codexHome, next)
              return next
            },
            delete: async () => {
              throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
            },
          },
          authContext: {
            env: async () => undefined,
            fileExists: async () => false,
          },
        },
      },
      { reasoningDefaults },
    )

    let adapterRegistration: AdapterRegistrationHandle | undefined
    let directoryRegistration: DirectoryRegistrationHandle | undefined
    const modelDiscoveries = new Map<string, { readonly route: KeyedRoute; readonly dispose: () => void }>()

    const registerCommandCodeDiscovery = (id: string, route: KeyedRoute): void => {
      const dispose = llm.registerModelDiscovery(`ai-accounts.${route.kind}.${id}`, async request => {
        const entries = await fetchCommandCodeCatalog(discoveryCatalogOptions(request, { apiBaseUrl: route.apiBaseUrl, keyEnv: route.apiKeyEnv }))
        return entries.map(entry => ({
          id: entry.id,
          contextWindow: 128_000,
          maxTokens: 8_192,
          inputModalities: ['text'],
        }))
      })
      modelDiscoveries.set(id, { route, dispose })
    }

    const applyRouteSnapshot = (sourceFile: ReturnType<typeof readAccountFileSync>): void => {
      const nextConfig = configFromAccountsFile(sourceFile)
      const { routes: nextRoutes, rejected } = buildRoutes(nextConfig)
      for (const reason of rejected) ctx.logger.warn(`ai-accounts: skipped account ${reason}`)
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
      if (directoryRegistration === undefined) {
        if (directoryEntries.length > 0) directoryRegistration = llm.registerConfigurableProviders(directoryEntries)
      } else {
        directoryRegistration.replace(directoryEntries)
      }

      for (const [id, registration] of modelDiscoveries) {
        const nextRoute = nextRoutes.get(id)
        if (
          nextRoute?.kind === COMMANDCODE_KIND &&
          nextRoute.enabled &&
          registration.route.apiBaseUrl === nextRoute.apiBaseUrl &&
          registration.route.apiKeyEnv === nextRoute.apiKeyEnv
        ) {
          continue
        }
        registration.dispose()
        modelDiscoveries.delete(id)
      }
      for (const [id, route] of enabled) {
        if (route.kind !== COMMANDCODE_KIND || modelDiscoveries.has(id)) continue
        registerCommandCodeDiscovery(id, route)
      }

      pool.replace([...nextRoutes].map(([id, route]) => ({ id, kind: route.kind, label: route.displayName, enabled: route.enabled })))
      pool.setDistribution(nextConfig.distribution)
      config = nextConfig
      routes = nextRoutes
      profiles = buildProfiles(nextConfig, nextRoutes, sourceFile)
      reasoningDefaults.clear()
      for (const [id, pins] of buildReasoningDefaults(sourceFile)) reasoningDefaults.set(id, pins)
      runtime.accounts = { config, pool }
    }

    applyRouteSnapshot(initialFile)
    let refreshQueue: Promise<void> = Promise.resolve()
    const refreshRoutes = (): Promise<void> => {
      const next = refreshQueue.then(async () => applyRouteSnapshot(await readAccountFile()))
      refreshQueue = next.catch(() => {
        ctx.logger.warn('ai-accounts: provider route refresh failed')
      })
      return next
    }
    runtime.refreshRoutes = refreshRoutes

    const disposers: Array<() => void> = []

    ctx.effect(() => {
      disposers.push(
        ctx.on('llm/stream', (options: GenerateOptions, next: () => AsyncIterable<StreamChunk>) => {
          // A conversation's account is bound before the call and credited only
          // after the upstream answers, so a failed attempt is never "used".
          const account = pool.acquire(options.sessionId)
          return (async function* pass(): AsyncIterable<StreamChunk> {
            let failed = false
            const used = account?.id
            for await (const chunk of next()) {
              if (chunk.type === 'finish' && chunk.reason.kind === 'error') {
                failed = true
                continue
              }
              if (!failed && chunk.type === 'usage' && used !== undefined) {
                pool.noteServed(used)
              }
              yield chunk
            }
          })()
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
            const offRequestError = agent.ctx.on('agent/request-error', (error, next) => {
              if (!isRateLimitFailure(error.failure)) return next()
              const served = pool.acquire(id)
              if (served?.id !== error.provider) return next()
              pool.noteRateLimited(error.provider, error.failure.providerRetryAfterMs)
              pool.unbind(id)
              ctx.logger.info(`ai-accounts: ${error.provider} is rate limited; the retry can use another account (${pool.distribution()})`)
              return next()
            })
            agent.ctx.on('agent/disposed', () => pool.unbind(id))
            return () => offRequestError()
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
        for (const registration of modelDiscoveries.values()) registration.dispose()
        modelDiscoveries.clear()
        for (const dispose of disposers) dispose()
        for (const dispose of perAgent.values()) dispose()
        perAgent.clear()
      }
    })
  },
})
