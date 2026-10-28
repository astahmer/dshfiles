import {
  createAssistantMessageEventStream,
  createProvider,
  type AssistantMessage,
  type AssistantMessageEvent,
  type AssistantMessageEventStream,
  type Model,
  type ProviderStreams,
  type SimpleStreamOptions,
  type TranscriptContext,
} from '@earendil-works/pi-ai'
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { z } from 'zod'
import { AccountsRules } from './api.js'
import { CommandCodeCapabilities } from './commandcode-capabilities.js'
import { streamCommandCodeCli } from './commandcode-cli.js'
import { CredentialModel, type CredentialValueResolver } from './credentials.js'
import { isEmptyCompletion } from './empty-response.js'
import { providerFetch } from './provider-request.js'

/**
 * Command Code as a provider.
 *
 * Two transports serve the same models. The CLI endpoint (`/alpha/generate`,
 * see `commandcode-cli.ts`) works on every plan and is the only one a Go plan
 * may use. The Provider API (`/provider/v1`, OpenAI or Anthropic Messages
 * shape) skips the system prompt the CLI gateway prepends, so a plan known to
 * include it uses it. Every model therefore declares the one `commandcode` API
 * and the choice is made per request, from the key's subscription.
 */

export const COMMANDCODE_KIND = 'commandcode'

export const DEFAULT_COMMANDCODE_BASE_URL = 'https://api.commandcode.ai'

export const DEFAULT_COMMANDCODE_KEY_ENV = 'COMMANDCODE_API_KEY'

const COMMANDCODE_API = 'commandcode'

/** The Provider API shape that serves a model when that transport is used. */
type ProviderApiShape = 'openai-completions' | 'anthropic-messages'

export interface CatalogEntry {
  readonly id: string
  readonly api: ProviderApiShape
  readonly contextWindow?: number
}

export interface CommandCodeProviderOptions {
  readonly baseUrl?: string
  readonly keyEnv?: string
  readonly authSource?: 'cli' | 'reference' | undefined
  readonly resolveCredential?: CredentialValueResolver
  /** Last resort when neither a stored credential nor the key variable holds a key, e.g. `~/.commandcode/auth.json`. */
  readonly readFallbackKey?: () => Promise<string>
}

export interface CommandCodeCatalogOptions {
  readonly baseUrl?: string | undefined
  /** The key itself, already resolved for exactly this base. */
  readonly apiKey: string
  readonly signal?: AbortSignal | undefined
}

/**
 * A floor catalog so the route is usable before the live catalog is read. It is
 * deliberately small; the real list comes from {@link fetchCommandCodeCatalog}.
 */
const FALLBACK: readonly CatalogEntry[] = [
  { id: 'gpt-6-luna', api: 'openai-completions' },
  { id: 'deepseek/deepseek-v4-flash', api: 'openai-completions' },
  { id: 'claude-sonnet-5-5', api: 'anthropic-messages' },
  { id: 'google/gemini-3.8-flash', api: 'openai-completions' },
]

const commandCodeCatalogResponseSchema = z.object({
  data: z
    .array(
      z.object({
        id: z.string().trim().min(1).max(200),
        context_length: z.number().int().positive().optional(),
        supported_endpoints: z.array(z.string()).max(20).optional(),
      }),
    )
    .max(500),
})

const subscriptionSchema = z.object({ data: z.object({ planId: z.string().nullish() }).nullish() })

export class CommandCodeConfigError extends Error {}

export class CommandCodeProviderModel {
  static readonly resolveBase = (baseUrl: string | undefined): string => {
    const base = baseUrl === undefined || baseUrl.trim() === '' ? DEFAULT_COMMANDCODE_BASE_URL : baseUrl.trim()
    if (!AccountsRules.isAllowedCommandCodeBase(base)) {
      throw new CommandCodeConfigError(`Refusing Command Code base '${base}': use https on commandcode.ai, or a loopback address.`)
    }
    return base.replace(/\/$/, '')
  }

  static readonly explainFailure = (message: string): string =>
    /^404\b/.test(message)
      ? `${message} — Command Code has no such route; check the account's API base URL (expected ${DEFAULT_COMMANDCODE_BASE_URL}).`
      : message
}

const resolveKeyEnv = (keyEnv: string | undefined): string => {
  const name = keyEnv === undefined || keyEnv.trim() === '' ? DEFAULT_COMMANDCODE_KEY_ENV : keyEnv.trim()
  if (!AccountsRules.isKeyEnvName(name)) {
    throw new CommandCodeConfigError(`Refusing key variable '${name}': name one ending in _API_KEY.`)
  }
  return name
}

/**
 * The Provider API lives under `/provider/v1`. The OpenAI SDK appends
 * `/chat/completions` to its base and the Anthropic SDK appends `/v1/messages`,
 * so the two shapes need different bases; a bare `/provider` base answers 404.
 */
const baseFor = (root: string, api: ProviderApiShape): string => (api === 'anthropic-messages' ? `${root}/provider` : `${root}/provider/v1`)

/** Claude ids no longer carry an `anthropic/` prefix, so either spelling marks a Messages-only model. */
const messagesOnlyById = (id: string): boolean => id.startsWith('anthropic/') || id.startsWith('claude')

/**
 * Read the live catalog so the picker offers what the plan actually serves.
 *
 * The catalog names the endpoints that serve each model; the id is only the
 * fallback signal for which Provider API shape a model needs.
 */
export const fetchCommandCodeCatalog = async (options: CommandCodeCatalogOptions): Promise<readonly CatalogEntry[]> => {
  const base = CommandCodeProviderModel.resolveBase(options.baseUrl)
  if (options.apiKey.length === 0) return FALLBACK
  const response = await providerFetch({
    provider: 'commandcode',
    operation: 'catalog',
    url: `${base}/provider/v1/models`,
    init: { headers: { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' }, signal: options.signal ?? null },
  })
  if (!response.ok) return FALLBACK
  const parsed = commandCodeCatalogResponseSchema.safeParse(await response.json())
  if (!parsed.success) return FALLBACK
  const entries: CatalogEntry[] = parsed.data.data.map(row => {
    const endpoints = row.supported_endpoints
    const messagesOnly = endpoints === undefined ? messagesOnlyById(row.id) : endpoints.includes('/messages') && !endpoints.includes('/chat/completions')
    return {
      id: row.id,
      api: messagesOnly ? 'anthropic-messages' : 'openai-completions',
      ...(row.context_length === undefined ? {} : { contextWindow: row.context_length }),
    }
  })
  return entries.length === 0 ? FALLBACK : entries
}

const commandCodeModel = (id: string, root: string, contextWindow?: number): Model<string> => {
  const thinkingLevelMap = CommandCodeCapabilities.thinkingLevelMap(id)
  return {
    id,
    name: id,
    api: COMMANDCODE_API,
    provider: COMMANDCODE_KIND,
    baseUrl: root,
    reasoning: thinkingLevelMap !== undefined,
    ...(thinkingLevelMap === undefined ? {} : { thinkingLevelMap }),
    input: CommandCodeCapabilities.readsImages(id) ? ['text', 'image'] : ['text'],
    contextWindow: contextWindow ?? 128_000,
    maxTokens: CommandCodeCapabilities.maxOutputTokens(id),
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }
}

/**
 * Settle a content-free response as one DSH classifies as a failed attempt.
 *
 * A reasoning-only response settles as `stop` with only a thinking block. DSH
 * reads that as a finished turn, the goal-round driver reads a finished turn as
 * "start the next round", and a degraded provider then spends the whole round
 * budget producing nothing (`session-dbe87c63`: 111 empty rounds). Throwing
 * does not help: pi-ai's lazy stream turns a throw into an uncoded error that
 * DSH files as `PI_AI_ERROR`, which no retry policy lists. DSH does classify a
 * `stop` with no content blocks as `EMPTY_RESPONSE`, so that is what an
 * unanswered settlement becomes. Both entry points are wrapped because DSH
 * streams through `streamSimple`.
 */
const settleEmptyAsFailure = (event: AssistantMessageEvent): AssistantMessageEvent => {
  if (event.type !== 'done' || !isEmptyCompletion(event.message)) return event
  return { type: 'done', reason: 'stop', message: { ...event.message, content: [], stopReason: 'stop' } }
}

const GO_PLAN_REFUSAL = /upgrade_required|plan doesn't include API access/i

const explainEvent = (event: AssistantMessageEvent): AssistantMessageEvent =>
  event.type === 'error' && event.error.errorMessage !== undefined
    ? { ...event, error: { ...event.error, errorMessage: CommandCodeProviderModel.explainFailure(event.error.errorMessage) } }
    : event

type Transport = 'cli' | 'provider'

/** How long a key's subscription answer is trusted before it is read again. */
const PLAN_TTL_MS = 300_000

/** Plans that include the Provider API. Go is the one plan without it; unknown plans take the CLI, which serves them all. */
const PROVIDER_API_PLAN = /^(individual-(goat|pro|provider|max|ultra)|teams-)/i

export const createCommandCodeProvider = (options: CommandCodeProviderOptions = {}) => {
  const root = CommandCodeProviderModel.resolveBase(options.baseUrl)
  const keyEnv = resolveKeyEnv(options.keyEnv)
  const shapes = new Map<string, ProviderApiShape>()
  const transports = new Map<string, { readonly transport: Promise<Transport>; readonly at: number }>()
  const providerApis: Record<ProviderApiShape, ProviderStreams> = {
    'openai-completions': openAICompletionsApi(),
    'anthropic-messages': anthropicMessagesApi(),
  }

  const modelsFor = (entries: readonly CatalogEntry[]): readonly Model<string>[] =>
    entries.map(entry => {
      shapes.set(entry.id, entry.api)
      return commandCodeModel(entry.id, root, entry.contextWindow)
    })

  const transportFor = (apiKey: string, fetchImpl: typeof fetch): Promise<Transport> => {
    const cached = transports.get(apiKey)
    if (cached !== undefined && Date.now() - cached.at < PLAN_TTL_MS) return cached.transport
    const transport = (async (): Promise<Transport> => {
      try {
        const response = await fetchImpl(`${root}/alpha/billing/subscriptions`, {
          headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json' },
          signal: AbortSignal.timeout(10_000),
        })
        if (!response.ok) return 'cli'
        const parsed = subscriptionSchema.safeParse(await response.json())
        const planId = parsed.success ? (parsed.data.data?.planId ?? '') : ''
        return PROVIDER_API_PLAN.test(planId) ? 'provider' : 'cli'
      } catch {
        return 'cli'
      }
    })()
    transports.set(apiKey, { transport, at: Date.now() })
    return transport
  }

  const viaProviderApi = (model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): AssistantMessageEventStream => {
    const shape = shapes.get(model.id) ?? (messagesOnlyById(model.id) ? 'anthropic-messages' : 'openai-completions')
    const shaped =
      shape === 'openai-completions'
        ? { ...model, api: shape, baseUrl: baseFor(root, shape), compat: { supportsReasoningEffort: true } }
        : { ...model, api: shape, baseUrl: baseFor(root, shape) }
    return providerApis[shape].streamSimple(shaped, context, streamOptions)
  }

  /**
   * Pick the transport, then forward its events. A Provider API refusal that
   * arrives before any content means the plan lost API access since it was
   * read; the key is moved to the CLI and the same request is sent there.
   */
  const route = (model: Model<string>, context: TranscriptContext, streamOptions: SimpleStreamOptions | undefined): AssistantMessageEventStream => {
    const target = createAssistantMessageEventStream()
    const cli = (): AssistantMessageEventStream =>
      streamCommandCodeCli({ root, model, context, ...(streamOptions === undefined ? {} : { options: streamOptions }) })
    const forward = async (source: AssistantMessageEventStream, onEarlyRefusal?: () => AssistantMessageEventStream): Promise<void> => {
      const held: AssistantMessageEvent[] = []
      let committed = onEarlyRefusal === undefined
      for await (const raw of source) {
        const event = explainEvent(settleEmptyAsFailure(raw))
        if (!committed) {
          if (event.type === 'start') {
            held.push(event)
            continue
          }
          if (event.type === 'error' && onEarlyRefusal !== undefined && GO_PLAN_REFUSAL.test(event.error.errorMessage ?? '')) {
            return forward(onEarlyRefusal())
          }
          committed = true
          for (const early of held) target.push(early)
        }
        target.push(event)
        if (event.type === 'done') return target.end(event.message)
        if (event.type === 'error') return target.end(event.error)
      }
      target.end()
    }
    void (async () => {
      const apiKey = streamOptions?.apiKey ?? ''
      const transport = apiKey === '' ? 'cli' : await transportFor(apiKey, streamOptions?.fetch ?? fetch)
      if (transport === 'cli') return forward(cli())
      return forward(viaProviderApi(model, context, streamOptions), () => {
        transports.set(apiKey, { transport: Promise.resolve('cli'), at: Date.now() })
        return cli()
      })
    })().catch((error: unknown) => {
      const message: AssistantMessage = {
        role: 'assistant',
        content: [],
        api: model.api,
        provider: model.provider,
        model: model.id,
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        stopReason: 'error',
        errorMessage: error instanceof Error ? error.message : String(error),
        timestamp: Date.now(),
      }
      target.push({ type: 'error', reason: 'error', error: message })
      target.end(message)
    })
    return target
  }

  const provider = createProvider({
    id: COMMANDCODE_KIND,
    name: 'Command Code',
    baseUrl: root,
    auth: {
      apiKey: {
        name: 'Command Code API key',
        login: async () => ({ type: 'api_key' as const, key: '' }),
        resolve: async ({
          signal,
          ctx,
          credential,
        }: {
          signal: { throwIfAborted: () => void }
          ctx: { env: (name: string) => Promise<string | undefined> }
          credential?: { key?: string }
        }) => {
          signal.throwIfAborted()
          if (options.authSource === 'cli') {
            const key = (await options.readFallbackKey?.()) ?? ''
            signal.throwIfAborted()
            return key === '' ? undefined : { auth: { apiKey: key }, source: 'Command Code CLI login' }
          }
          if (credential?.key !== undefined && credential.key.length > 0) {
            return { auth: { apiKey: credential.key }, source: 'stored credential' }
          }
          const value = await ctx.env(keyEnv)
          signal.throwIfAborted()
          if (value !== undefined && value.length > 0) return { auth: { apiKey: value }, source: keyEnv }
          const fallback = options.authSource === 'reference' ? '' : ((await options.readFallbackKey?.()) ?? '')
          signal.throwIfAborted()
          return fallback.length === 0 ? undefined : { auth: { apiKey: fallback }, source: 'Command Code CLI login' }
        },
      },
    },
    models: modelsFor(FALLBACK),
    // pi-ai calls this during a catalog refresh and owns persistence of the
    // result, so it only has to answer with the models it advertises now.
    fetchModels: async () => {
      const named =
        options.authSource === 'cli'
          ? ''
          : options.resolveCredential === undefined
            ? CredentialModel.readKeyFromEnv(keyEnv)
            : await options.resolveCredential(keyEnv)
      const apiKey = named.length > 0 ? named : options.authSource === 'reference' ? '' : ((await options.readFallbackKey?.()) ?? '')
      return modelsFor(await fetchCommandCodeCatalog({ baseUrl: options.baseUrl, apiKey }))
    },
    api: {
      [COMMANDCODE_API]: {
        stream: (model, context, streamOptions) => route(model, context, streamOptions),
        streamSimple: (model, context, streamOptions) => route(model, context, streamOptions),
      },
    },
  })
  return {
    ...provider,
    /** A model discovered after boot, with this model's own capabilities rather than a template's. */
    describeModel: (id: string, contextWindow?: number): Model<string> => commandCodeModel(id, root, contextWindow),
  }
}
