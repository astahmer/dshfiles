import { accountRuntime, activateAccountRuntime } from './account-runtime.js'
import { configFromAccountsFile, type AiAccountsConfig, type CodexAccountConfig } from './account-config.js'
export { Config } from './account-config.js'
import type { Context } from '@deepseek-ai/cordis'
// Brings in the CSS-module declarations a plugin would otherwise restate.
import type {} from '@dshfiles/dshx/client'
import { aiAccountsApi, type AccountProfile, type AccountsFile, type AccountsUsage, type UsageCard } from './api.js'
import {
  buildAccountsFile,
  primeAccountFile,
  readAccountFile,
  readAccountFileSync,
  readAccountIdentity,
  removeAccount,
  setDistribution,
  upsertAccount,
} from './account-store.js'
import { aiAccountsTool } from './accounts-tool.js'
import { readCodexUsage, readOpenCodeUsage } from './usage.js'
import { createUsageHistoryScheduler, readUsageHistory, readUsageHistorySettings, saveUsageHistorySettings } from './usage-recorder.js'
import { fetchCommandCodeCatalog } from './commandcode-provider.js'
import { discoveryCatalogOptions, readKeyFromEnv } from './credentials.js'
import { definePlugin } from '@dshfiles/dshx/host'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import { COMMANDCODE_KIND as CC_KIND, DEFAULT_COMMANDCODE_KEY_ENV, createCommandCodeProvider } from './commandcode-provider.js'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
// Value imports, not `import type {}`: an empty type-only import is elided and
// never loads the package's cordis module augmentation, which is what makes
// `ctx.on('llm/stream')` and the agent-scoped listeners typecheck here.
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import { createAccountPool, isRateLimitFailure } from './account-pool.js'
import { materializeCodexShadowHome, CodexHomeError, resolveCodexHomeLayout, type CodexHomeLayout } from './codex-home.js'
import { readCodexAccessToken } from './read-codex-token.js'
import { persistCodexOAuthCredential, readCodexOAuthCredential } from './codex-credential.js'

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

export const CODEX_KIND = 'codex'
export const OPENCODE_KIND = 'opencode-go'
export const COMMANDCODE_KIND = CC_KIND

const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** An empty instance id means "the driver's own default route". */
const normalizeInstanceId = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  if (!SLUG_PATTERN.test(trimmed)) {
    throw new TypeError(`Instance id ${JSON.stringify(trimmed)} must start with a letter and use only letters, digits, '-' or '_' (max 64 characters).`)
  }
  return trimmed
}

const displayNameFor = (explicit: string, kind: string, instanceId: string): string => {
  const trimmed = explicit.trim()
  if (trimmed.length > 0) return trimmed
  return instanceId === kind ? kind : `${kind} (${instanceId})`
}

interface CodexRoute {
  readonly kind: typeof CODEX_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
  readonly layout: CodexHomeLayout
}

interface KeyedRoute {
  readonly kind: typeof OPENCODE_KIND | typeof COMMANDCODE_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly apiKeyEnv: string
  readonly apiBaseUrl: string
  readonly enabled: boolean
}

type Route = CodexRoute | KeyedRoute

const keyEnvFor = (route: KeyedRoute): string =>
  route.apiKeyEnv.trim().length > 0 ? route.apiKeyEnv.trim() : route.kind === COMMANDCODE_KIND ? DEFAULT_COMMANDCODE_KEY_ENV : 'OPENCODE_API_KEY'

const shadowHomeFor = (account: CodexAccountConfig, instanceId: string, root: string): string => {
  const explicit = account.shadowHomePath.trim()
  if (explicit.length > 0) return explicit
  // One shadow per account under a single root keeps the T3 trick without
  // making every account restate the path.
  return `${root.replace(/\/$/, '')}/${instanceId}`
}

const buildProfile = (params: {
  /** Per-model default effort ids this account pins. */
  readonly reasoningDefaults?: Readonly<Record<string, string>>
  /** Ids this account never offers. */
  readonly hiddenModelIds?: readonly string[]
  /** Ids offered ahead of the rest. */
  readonly favoriteModelIds?: readonly string[]
  /** Explicit ordering; unlisted ids keep provider order after these. */
  readonly modelOrder?: readonly string[]
  readonly upstream: ReturnType<typeof openaiCodexProvider> | ReturnType<typeof opencodeGoProvider>
  readonly provider: string
  readonly displayName: string
  readonly additionalModelIds: readonly string[]
}): ResolvedPiAiProviderProfile => {
  const hidden = new Set(params.hiddenModelIds ?? [])
  const favorites = new Set(params.favoriteModelIds ?? [])
  const order = params.modelOrder ?? []
  const rank = (id: string): number => {
    const listed = order.indexOf(id)
    if (listed >= 0) return listed
    // Unlisted models follow the explicit ones, favorites first among them, then
    // the provider's own order, so adding a model never reshuffles the rest.
    return order.length + (favorites.has(id) ? 0 : 1)
  }
  const models = params.upstream
    .getModels()
    .filter(model => !hidden.has(model.id))
    .map(model => ({ ...model, provider: params.provider }))
    .sort((left, right) => rank(left.id) - rank(right.id))
  const template = models.find(model => model.id.startsWith('gpt-'))
  for (const id of params.additionalModelIds) {
    if (template === undefined || models.some(model => model.id === id)) continue
    models.push({ ...template, id, provider: params.provider })
  }
  // A pinned effort is offered as an override on the model it belongs to, which
  // is the seam the adapter materializes a default through: an explicit caller
  // choice still wins, and an unpinned model keeps the provider's own default.
  const pins = params.reasoningDefaults ?? {}
  const modelOverrides = Object.fromEntries(
    Object.entries(pins).flatMap(([modelId, effortId]) => {
      const model = models.find(candidate => candidate.id === modelId)
      if (model === undefined) return []
      const levels = (model as { thinkingLevelMap?: Record<string, string | null> }).thinkingLevelMap
      if (levels !== undefined && levels[effortId] === null) return []
      return [[modelId, { reasoningEfforts: { [effortId]: levels?.[effortId] ?? effortId } }]]
    }),
  )

  return {
    provider: params.provider,
    displayName: params.displayName,
    ...(Object.keys(modelOverrides).length === 0 ? {} : { modelOverrides }),
    transport: 'sse',
    streamIdleTimeoutMs: 120_000,
    maxRequestImageBytes: 20_971_520,
    requestImagePixelBudget: 4_194_304,
    requestImageMaxBytes: 1_048_576,
    modelErrors: new Map(),
    configuredMaxTokens: new Map(),
    retryPolicy: {
      mode: 'normal',
      maxRetries: 2,
      retryableCodes: ['RATE_LIMIT', 'OVERLOADED', 'TRANSPORT', 'TIMEOUT'],
      initialDelayMs: 1_000,
      maxDelayMs: 30_000,
      jitterRatio: 0.2,
    },
    piProvider: {
      ...params.upstream,
      id: params.provider,
      name: params.displayName,
      getModels: () => models,
    },
  }
}

interface BuiltRoutes {
  readonly routes: Map<string, Route>
  /** Accounts left out because their Codex home is invalid, with the reason. */
  readonly rejected: readonly string[]
}

const buildRoutes = (config: AiAccountsConfig): BuiltRoutes => {
  const routes = new Map<string, Route>()
  const rejected: string[] = []
  for (const account of config.codexAccounts) {
    const instanceId = normalizeInstanceId(account.instanceId, CODEX_KIND)
    let layout: CodexHomeLayout
    try {
      layout = resolveCodexHomeLayout({
        homePath: account.homePath,
        shadowHomePath: shadowHomeFor(account, instanceId, config.codexShadowRoot),
      })
    } catch (error) {
      if (!(error instanceof CodexHomeError)) throw error
      rejected.push(`${instanceId}: ${error.message}`)
      continue
    }
    routes.set(instanceId, {
      kind: CODEX_KIND,
      instanceId,
      displayName: displayNameFor(account.displayName, CODEX_KIND, instanceId),
      enabled: account.enabled,
      layout,
    })
  }
  for (const account of config.opencodeAccounts) {
    const kind = account.kind === COMMANDCODE_KIND ? COMMANDCODE_KIND : OPENCODE_KIND
    const instanceId = normalizeInstanceId(account.instanceId, kind)
    routes.set(instanceId, {
      kind,
      instanceId,
      displayName: displayNameFor(account.displayName, kind, instanceId),
      apiKeyEnv: account.apiKeyEnv,
      apiBaseUrl: account.apiBaseUrl,
      enabled: account.enabled,
    })
  }
  return { routes, rejected }
}

/**
 * The one read operation. Profiles come from the accounts file, joined with the
 * pool's live health and each home's observed login, so the page and the agent's
 * `ai_accounts` tool can never describe different state.
 */
const accountsFile = async (ctx: Context): Promise<AccountsFile> =>
  buildAccountsFile(await readAccountFile(), accountRuntime(ctx)?.accounts?.pool.describe() ?? [])

export const accountsSnapshot = accountsFile

const accountsHostApi = aiAccountsApi.host({
  read: async ({ ctx }) => {
    // A changed file means changed routes, so rebuild before answering.
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  save: async ({ input, ctx }) => {
    await upsertAccount(input.draft)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  remove: async ({ input, ctx }) => {
    await removeAccount(input.instanceId)
    await refreshRoutes(ctx)
    return accountsFile(ctx)
  },
  setDistribution: async ({ input, ctx }) => {
    await setDistribution(input.distribution)
    accountRuntime(ctx)?.accounts?.pool.setDistribution(input.distribution)
    return accountsFile(ctx)
  },
  identity: async ({ input }) => readAccountIdentity(input.instanceId),
  catalog: async ({ input, ctx }) => {
    const llm = ctx.get('llm')
    if (llm === undefined) return { instanceId: input.instanceId, models: [] }
    const models = await llm.listModels(input.instanceId)
    const resolved = await Promise.all(
      models.map(async model => {
        const info = await llm.resolveModelInfo(input.instanceId, model.id)
        return {
          id: model.id,
          name: model.name,
          efforts: (info.reasoning?.efforts ?? []).map(effort => ({
            id: effort.id,
            name: effort.name,
          })),
          defaultEffort: info.reasoning?.defaultEffort ?? null,
        }
      }),
    )
    return { instanceId: input.instanceId, models: resolved }
  },
  usage: async ({ ctx }) => readAccountsUsage(ctx),
  history: async ({ input, ctx }) => ({
    instanceId: input.instanceId,
    points: [...(await readUsageHistory(ctx, input.instanceId, Date.now() - input.days * 24 * 60 * 60_000))],
  }),
  historySettings: async ({ ctx }) => readUsageHistorySettings(ctx),
  saveHistorySettings: async ({ input, ctx }) => saveUsageHistorySettings(ctx, input),
  collectUsage: async ({ ctx }) => ({ recorded: (await accountRuntime(ctx)?.scheduler?.collectNow()) ?? 0 }),
})

/**
 * One account's live quota.
 *
 * A keyed provider reports against its own key, and Codex against the login in
 * its own home. A provider with no reachable quota endpoint is reported as
 * unsupported rather than failing the sweep.
 */
const readAccountUsage = async (account: AccountProfile): Promise<UsageCard> => {
  if (account.kind === 'codex') {
    return readCodexUsage(
      resolveCodexHomeLayout({
        homePath: account.homePath,
        shadowHomePath: account.shadowHomePath,
      }).effectiveHomePath,
    )
  }
  if (account.kind === 'commandcode') return unsupported()
  return readOpenCodeUsage(readKeyFromEnv(account.apiKeyEnv))
}

const unsupported = (): UsageCard => ({
  status: 'unsupported',
  message: null,
  identity: null,
  plan: null,
  windows: [],
  bankedResets: 0,
  bankedResetExpiries: [],
})

/**
 * Live quota for every account, read with each account's own credential.
 *
 * One sweep covers the whole panel: the Client renders it as cards and refreshes
 * on an interval, so a provider that is slow or down costs its own card rather
 * than the panel.
 */
const readAccountsUsage = async (ctx: Context): Promise<AccountsUsage> => {
  // Read the observed file so a Codex account uses the same shadow home the
  // panel already shows, not a re-derived guess.
  const file = await accountsFile(ctx)
  const cards = await Promise.all(
    file.accounts.map(async account => ({
      instanceId: account.instanceId,
      usage: await readAccountUsage(account),
    })),
  )
  return { readAt: Date.now(), cards }
}

/**
 * Rebuild provider routes from the accounts file.
 *
 * Routes are derived state, so editing a profile changes the model picker. The
 * pool is reused across a rebuild so a rate-limited account stays cooling rather
 * than being reset by an unrelated save, and only accounts whose identity or
 * enabled flag actually changed are re-registered, because the adapter registry
 * rejects a duplicate route for one already taken.
 */
const refreshRoutes = async (ctx: Context): Promise<void> => {
  const activeAccounts = accountRuntime(ctx)?.accounts
  if (activeAccounts === undefined) return
  const file = await readAccountFile()
  const config = configFromAccountsFile(file)
  activeAccounts.config = config
  activeAccounts.pool.setDistribution(file.distribution)
}

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
    const file = readAccountFileSync()
    const config = configFromAccountsFile(file)
    const { routes, rejected } = buildRoutes(config)
    for (const reason of rejected) ctx.logger.warn(`ai-accounts: skipped account ${reason}`)
    if (routes.size === 0) return
    const enabled = [...routes].filter(([, route]) => route.enabled)
    if (enabled.length === 0) return

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
    const curation = readAccountFileSync().accounts.map(
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

    const reasoningPins = readAccountFileSync().accounts.map(
      account =>
        [
          account.instanceId,
          typeof account.reasoningDefaults === 'object' && account.reasoningDefaults !== null ? (account.reasoningDefaults as Record<string, string>) : {},
        ] as const,
    )

    const profiles = new Map<string, ResolvedPiAiProviderProfile>(
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
              ? (config.codexAccounts.find(account => normalizeInstanceId(account.instanceId, CODEX_KIND) === id)?.additionalModelIds ?? [])
              : [],
        }),
      ]),
    )

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

    const adapter = new PiAiAdapter({
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
    })

    const disposers: Array<() => void> = []

    llm.registerConfigurableProviders(
      enabled.map(([id, route]) => ({
        provider: id,
        displayName: route.displayName,
        settingsNs: `ai-accounts.${route.kind}.${id}`,
        settingsPath: [],
      })),
    )
    llm.registerAdapter(
      enabled.map(([id]) => id),
      adapter,
    )

    // Offer catalog discovery for each route's settings namespace, so the Models
    // page can interrogate the endpoint and offer newly advertised models rather
    // than leaving the picker on whatever shipped with the plugin.
    for (const [id, route] of enabled) {
      if (route.kind !== COMMANDCODE_KIND) continue
      disposers.push(
        llm.registerModelDiscovery(`ai-accounts.${route.kind}.${id}`, async request => {
          const entries = await fetchCommandCodeCatalog(discoveryCatalogOptions(request, { apiBaseUrl: route.apiBaseUrl, keyEnv: keyEnvFor(route) }))
          return entries.map(entry => ({
            id: entry.id,
            contextWindow: 128_000,
            maxTokens: 8_192,
            inputModalities: ['text'],
          }))
        }),
      )
    }

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
        for (const dispose of disposers) dispose()
        for (const dispose of perAgent.values()) dispose()
        perAgent.clear()
      }
    })
  },
})
