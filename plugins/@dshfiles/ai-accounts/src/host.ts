import z from '@deepseek-ai/schemastery'
import { aiAccountsApi, type AccountsSnapshot } from './api.js'
import { buildAccountsSnapshot } from './account-snapshot.js'
import { defineHost, definePlugin } from '@becomeopc/dshx/host'
import { openaiCodexProvider } from '@earendil-works/pi-ai/providers/openai-codex'
import { opencodeGoProvider } from '@earendil-works/pi-ai/providers/opencode-go'
import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
// Value imports, not `import type {}`: an empty type-only import is elided and
// never loads the package's cordis module augmentation, which is what makes
// `ctx.on('llm/stream')` and the agent-scoped listeners typecheck here.
import { LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { ResolvedPiAiProviderProfile } from '@deepseek-ai/dsh-llm-pi-ai'
import { PiAiAdapter } from '@deepseek-ai/dsh-llm-pi-ai'
import {
  DEFAULT_DISTRIBUTION,
  DISTRIBUTIONS,
  createAccountPool,
  isRateLimitFailure,
  type Distribution,
} from './account-pool.js'
import {
  authJsonPath,
  codexLoginHint,
  describeCodexAuth,
  materializeCodexShadowHome,
  resolveCodexHomeLayout,
  type CodexHomeLayout,
} from './codex-home.js'
import { readCodexAccessToken } from './read-codex-token.js'

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
 * Account layout and the shadow-home trick follow T3 Code; quota reporting is
 * inspired by the ai-accounts plugin we own for BB, reimplemented on DSH seams.
 */

/**
 * DSH 0.2's `dsh-llm` declares this waterfall against cordis's `Events`.
 *
 * A plugin that resolves `dsh-llm` outside the profile's own tree sees a second
 * module identity for cordis, so the augmentation lands on an `Events` the
 * plugin never reads and `ctx.on('llm/stream')` is rejected by the type
 * checker. Restating the declaration here is exact: it mirrors the signature
 * the installed package documents, and TypeScript merges declarations.
 */
declare module '@deepseek-ai/cordis' {
  interface Events {
    'llm/stream'(
      this: unknown,
      options: GenerateOptions,
      next: () => AsyncIterable<StreamChunk>,
    ): AsyncIterable<StreamChunk>
  }
}

export const CODEX_KIND = 'codex'
export const OPENCODE_KIND = 'opencode-go'

const SLUG_PATTERN = /^[a-zA-Z][a-zA-Z0-9_-]{0,63}$/

/** An empty instance id means "the driver's own default route". */
const normalizeInstanceId = (value: string, fallback: string): string => {
  const trimmed = value.trim()
  if (trimmed.length === 0) return fallback
  if (!SLUG_PATTERN.test(trimmed)) {
    throw new TypeError(
      `Instance id ${JSON.stringify(trimmed)} must start with a letter and use only letters, digits, '-' or '_' (max 64 characters).`,
    )
  }
  return trimmed
}

const displayNameFor = (explicit: string, kind: string, instanceId: string): string => {
  const trimmed = explicit.trim()
  if (trimmed.length > 0) return trimmed
  return instanceId === kind ? kind : `${kind} (${instanceId})`
}

const CodexAccount = z.object({
  instanceId: z.string().default(CODEX_KIND),
  displayName: z.string().default(''),
  homePath: z.string().default(''),
  shadowHomePath: z.string().default(''),
  additionalModelIds: z.array(z.string()).default([]),
  enabled: z.boolean().default(true),
})

const OpenCodeAccount = z.object({
  instanceId: z.string().default(OPENCODE_KIND),
  displayName: z.string().default(''),
  enabled: z.boolean().default(true),
})

export interface CodexAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  readonly homePath: string
  readonly shadowHomePath: string
  readonly additionalModelIds: readonly string[]
  readonly enabled: boolean
}

export interface OpenCodeAccountConfig {
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
}

export interface AiAccountsConfig {
  readonly codexAccounts: readonly CodexAccountConfig[]
  readonly opencodeAccounts: readonly OpenCodeAccountConfig[]
  readonly opencodeApiKey: string
  readonly distribution: Distribution
  readonly cooldownMs: number
  readonly codexShadowRoot: string
}

interface CodexRoute {
  readonly kind: typeof CODEX_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
  readonly layout: CodexHomeLayout
}

interface OpenCodeRoute {
  readonly kind: typeof OPENCODE_KIND
  readonly instanceId: string
  readonly displayName: string
  readonly enabled: boolean
}

type Route = CodexRoute | OpenCodeRoute

const shadowHomeFor = (account: CodexAccountConfig, instanceId: string, root: string): string => {
  const explicit = account.shadowHomePath.trim()
  if (explicit.length > 0) return explicit
  // One shadow per account under a single root keeps the T3 trick without
  // making every account restate the path.
  return `${root.replace(/\/$/, '')}/${instanceId}`
}

const buildProfile = (params: {
  readonly upstream: ReturnType<typeof openaiCodexProvider> | ReturnType<typeof opencodeGoProvider>
  readonly provider: string
  readonly displayName: string
  readonly additionalModelIds: readonly string[]
}): ResolvedPiAiProviderProfile => {
  const models = params.upstream.getModels().map(model => ({
    ...model,
    provider: params.provider,
  }))
  const template = models.find(model => model.id.startsWith('gpt-'))
  for (const id of params.additionalModelIds) {
    if (template === undefined || models.some(model => model.id === id)) continue
    models.push({ ...template, id, provider: params.provider })
  }
  return {
    provider: params.provider,
    displayName: params.displayName,
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

const buildRoutes = (config: AiAccountsConfig): Map<string, Route> => {
  const routes = new Map<string, Route>()
  for (const account of config.codexAccounts) {
    const instanceId = normalizeInstanceId(account.instanceId, CODEX_KIND)
    routes.set(instanceId, {
      kind: CODEX_KIND,
      instanceId,
      displayName: displayNameFor(account.displayName, CODEX_KIND, instanceId),
      enabled: account.enabled,
      layout: resolveCodexHomeLayout({
        homePath: account.homePath,
        shadowHomePath: shadowHomeFor(account, instanceId, config.codexShadowRoot),
      }),
    })
  }
  for (const account of config.opencodeAccounts) {
    const instanceId = normalizeInstanceId(account.instanceId, OPENCODE_KIND)
    routes.set(instanceId, {
      kind: OPENCODE_KIND,
      instanceId,
      displayName: displayNameFor(account.displayName, OPENCODE_KIND, instanceId),
      enabled: account.enabled,
    })
  }
  return routes
}

const defaultConfig: AiAccountsConfig = {
  codexAccounts: [
    {
      instanceId: CODEX_KIND,
      displayName: '',
      homePath: '',
      shadowHomePath: '',
      additionalModelIds: [],
      enabled: true,
    },
  ],
  opencodeAccounts: [],
  opencodeApiKey: '',
  distribution: DEFAULT_DISTRIBUTION,
  cooldownMs: 300_000,
  codexShadowRoot: `${process.env.HOME ?? '~'}/.codex-dshx`,
}


export const Config = z.object({
  codexAccounts: z.array(CodexAccount).default([CodexAccount({})]).volatile(),
  opencodeAccounts: z.array(OpenCodeAccount).default([]).volatile(),
  opencodeApiKey: z.string().default('').volatile(),
  distribution: z.string().default(DEFAULT_DISTRIBUTION).volatile(),
  cooldownMs: z.number().default(300_000).volatile(),
  codexShadowRoot: z.string().default('').volatile(),
})

/** Live state the settings API and the status tool both read. */
let activeAccounts: {
  config: AiAccountsConfig
  pool: ReturnType<typeof createAccountPool>
} | undefined

/** The one snapshot operation: what accounts exist, and how healthy they are. */
export const accountsSnapshot = async (): Promise<AccountsSnapshot> => {
  if (activeAccounts === undefined) {
    return { distribution: 'sticky', distributions: [...DISTRIBUTIONS], cooldownMs: 0, accounts: [] }
  }
  return buildAccountsSnapshot({
    config: activeAccounts.config,
    statuses: activeAccounts.pool.describe(),
    distributions: [...DISTRIBUTIONS],
  })
}

const accountsHostApi = aiAccountsApi.host({
  snapshot: async () => accountsSnapshot(),
})

export default definePlugin({
  id: 'llm-ai-accounts',
  inject: ['llm', 'connection', 'webServer'],
  apis: [accountsHostApi],
  setup: api => {
    const ctx = api.raw.ctx
    const config = readConfig(api.config)
    const routes = buildRoutes(config)
    if (routes.size === 0) return
    const enabled = [...routes].filter(([, route]) => route.enabled)
    if (enabled.length === 0) return

    const codexUpstream = openaiCodexProvider()
    const opencodeUpstream = opencodeGoProvider()
    const profiles = new Map<string, ResolvedPiAiProviderProfile>(
      enabled.map(([id, route]) => [
        id,
        buildProfile({
          upstream: route.kind === CODEX_KIND ? codexUpstream : opencodeUpstream,
          provider: id,
          displayName: route.displayName,
          additionalModelIds:
            route.kind === CODEX_KIND
              ? (config.codexAccounts.find(
                  account => normalizeInstanceId(account.instanceId, CODEX_KIND) === id,
                )?.additionalModelIds ?? [])
              : [],
        }),
      ]),
    )

    const pool = createAccountPool({
      distribution: config.distribution,
      cooldownMs: config.cooldownMs,
    })
    activeAccounts = { config, pool }
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
        const key = config.opencodeApiKey.trim()
        if (key.length === 0) {
          throw new LlmError(
            `No OpenCode Go key configured for '${provider}'. Set ai-accounts.opencodeApiKey, or export OPENCODE_API_KEY.`,
            'MISSING_CREDENTIAL',
          )
        }
        return key
      },
      resolveAttachments: () => ctx.get('attachments'),
      resolveImageAccess: (attachments, ref) =>
        resolveImageAttachmentAccess(
          attachments,
          hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
          ref,
        ),
      auth: {
        credentials: {
          read: async () => undefined,
          list: async () => [],
          modify: async () => {
            throw new LlmError('Codex credentials are owned by Codex CLI', 'UNSUPPORTED_OPERATION')
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


    ctx.effect(() => {
      const disposers: Array<() => void> = []

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
              ctx.logger.info(
                `ai-accounts: ${error.provider} is rate limited; the retry can use another account (${pool.distribution()})`,
              )
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

/**
 * The row config the Loader hands to `apply`, tolerating both `definePlugin`
 * (where it arrives as `api.config`) and a bare `defineHost` setup.
 *
 * Reading `ctx.config` is wrong on protocol 2: the Loader reserves that name,
 * so an ordinary context has no such property and the access throws.
 */
const readPluginConfig = (ctx: unknown): Record<string, unknown> => {
  const holders = [
    ctx,
    (ctx as { raw?: unknown }).raw,
    (ctx as { raw?: { ctx?: unknown } }).raw?.ctx,
  ]
  for (const holder of holders) {
    if (holder === undefined || holder === null) continue
    let value: unknown
    try {
      value = (holder as { config?: unknown }).config
    } catch {
      continue
    }
    if (typeof value === 'object' && value !== null) return value as Record<string, unknown>
  }
  return {}
}

const readConfig = (input: Record<string, unknown>): AiAccountsConfig => {
  const raw = input ?? {}
  const accounts = Array.isArray(raw.codexAccounts) ? raw.codexAccounts : []
  const opencode = Array.isArray(raw.opencodeAccounts) ? raw.opencodeAccounts : []
  const toCodex = (value: unknown): CodexAccountConfig => {
    const record = (value ?? {}) as Record<string, unknown>
    return {
      instanceId: typeof record.instanceId === 'string' ? record.instanceId : CODEX_KIND,
      displayName: typeof record.displayName === 'string' ? record.displayName : '',
      homePath: typeof record.homePath === 'string' ? record.homePath : '',
      shadowHomePath: typeof record.shadowHomePath === 'string' ? record.shadowHomePath : '',
      additionalModelIds: Array.isArray(record.additionalModelIds)
        ? record.additionalModelIds.filter((id): id is string => typeof id === 'string')
        : [],
      enabled: record.enabled !== false,
    }
  }
  const toOpenCode = (value: unknown): OpenCodeAccountConfig => {
    const record = (value ?? {}) as Record<string, unknown>
    return {
      instanceId: typeof record.instanceId === 'string' ? record.instanceId : OPENCODE_KIND,
      displayName: typeof record.displayName === 'string' ? record.displayName : '',
      enabled: record.enabled !== false,
    }
  }
  const distribution = raw.distribution
  return {
    codexAccounts: accounts.length === 0 ? defaultConfig.codexAccounts : accounts.map(toCodex),
    opencodeAccounts: opencode.map(toOpenCode),
    opencodeApiKey:
      typeof raw.opencodeApiKey === 'string' && raw.opencodeApiKey.length > 0
        ? raw.opencodeApiKey
        : (process.env.OPENCODE_API_KEY ?? ''),
    distribution:
      typeof distribution === 'string' && DISTRIBUTIONS.includes(distribution as Distribution)
        ? (distribution as Distribution)
        : DEFAULT_DISTRIBUTION,
    cooldownMs: typeof raw.cooldownMs === 'number' ? raw.cooldownMs : defaultConfig.cooldownMs,
    codexShadowRoot:
      typeof raw.codexShadowRoot === 'string' && raw.codexShadowRoot.length > 0
        ? raw.codexShadowRoot
        : defaultConfig.codexShadowRoot,
  }
}
