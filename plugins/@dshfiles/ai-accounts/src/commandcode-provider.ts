import { createProvider, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'
import { LlmError } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import { isAllowedCommandCodeBase, isKeyEnvName } from './api.js'
import { readKeyFromEnv, type CredentialValueResolver } from './credentials.js'
import { describeEmptyResponse, EMPTY_RESPONSE_CODE, isEmptyCompletion } from './empty-response.js'

/**
 * Command Code as a provider.
 *
 * It speaks the OpenAI wire format at `api.commandcode.ai`, so this is pi-ai's own
 * provider machinery pointed at a different base rather than a hand-written
 * transport. One detail is not generic: its Claude models answer only on the
 * Anthropic Messages shape and refuse `/chat/completions` with a 400, so every
 * model declares the API that serves it and no caller has to know.
 */

export const COMMANDCODE_KIND = 'commandcode'

export const DEFAULT_COMMANDCODE_BASE_URL = 'https://api.commandcode.ai'

export const DEFAULT_COMMANDCODE_KEY_ENV = 'COMMANDCODE_API_KEY'

type CommandCodeApi = 'openai-completions' | 'openai-responses' | 'anthropic-messages'

export interface CatalogEntry {
  readonly id: string
  readonly api: CommandCodeApi
}

export interface CommandCodeProviderOptions {
  readonly baseUrl?: string
  readonly keyEnv?: string
  readonly resolveCredential?: CredentialValueResolver
}

export interface CommandCodeCatalogOptions {
  readonly baseUrl?: string
  /** The key itself, already resolved for exactly this base. */
  readonly apiKey: string
  readonly signal?: AbortSignal
}

/**
 * A floor catalog so the route is usable before the live catalog is read. It is
 * deliberately small; the real list comes from {@link fetchCommandCodeCatalog}.
 */
const FALLBACK: readonly CatalogEntry[] = [
  { id: 'gpt-6-luna', api: 'openai-completions' },
  { id: 'openai/gpt-5.1', api: 'openai-completions' },
  { id: 'anthropic/claude-sonnet-4-5', api: 'anthropic-messages' },
  { id: 'anthropic/claude-opus-4-1', api: 'anthropic-messages' },
  { id: 'google/gemini-3-pro', api: 'openai-completions' },
  { id: 'deepseek/deepseek-v3.2', api: 'openai-completions' },
]

const commandCodeCatalogResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().trim().min(1).max(200) })).max(500),
})

export class CommandCodeConfigError extends Error {}

export const resolveCommandCodeBase = (baseUrl: string | undefined): string => {
  const base = baseUrl === undefined || baseUrl.trim() === '' ? DEFAULT_COMMANDCODE_BASE_URL : baseUrl.trim()
  if (!isAllowedCommandCodeBase(base)) {
    throw new CommandCodeConfigError(`Refusing Command Code base '${base}': use https on commandcode.ai, or a loopback address.`)
  }
  return base.replace(/\/$/, '')
}

const resolveKeyEnv = (keyEnv: string | undefined): string => {
  const name = keyEnv === undefined || keyEnv.trim() === '' ? DEFAULT_COMMANDCODE_KEY_ENV : keyEnv.trim()
  if (!isKeyEnvName(name)) {
    throw new CommandCodeConfigError(`Refusing key variable '${name}': name one ending in _API_KEY.`)
  }
  return name
}

/** Command Code serves its OpenAI-compatible routes under a provider prefix. */
const providerBase = (baseUrl: string | undefined): string => `${resolveCommandCodeBase(baseUrl)}/provider`

/**
 * Read the live catalog so the picker offers what the plan actually serves.
 *
 * Its Claude models are only served on the Messages shape, so that is declared
 * per model here rather than discovered from a failed request later.
 */
export const fetchCommandCodeCatalog = async (options: CommandCodeCatalogOptions): Promise<readonly CatalogEntry[]> => {
  const base = resolveCommandCodeBase(options.baseUrl)
  if (options.apiKey.length === 0) return FALLBACK
  const response = await fetch(`${base}/provider/v1/models`, {
    headers: { authorization: `Bearer ${options.apiKey}`, accept: 'application/json' },
    signal: options.signal,
  })
  if (!response.ok) return FALLBACK
  const parsed = commandCodeCatalogResponseSchema.safeParse(await response.json())
  if (!parsed.success) return FALLBACK
  const entries: CatalogEntry[] = parsed.data.data.map(({ id }) => ({
    id,
    api: id.startsWith('anthropic/') ? 'anthropic-messages' : 'openai-completions',
  }))
  return entries.length === 0 ? FALLBACK : entries
}

const modelsFor = (entries: readonly CatalogEntry[], baseUrl: string): readonly Model<CommandCodeApi>[] =>
  entries.map(entry => ({
    id: entry.id,
    name: entry.id,
    api: entry.api,
    provider: COMMANDCODE_KIND,
    baseUrl,
    reasoning: false,
    // Annotated, because an inline literal widens `string[]` and no longer satisfies
    // the tuple the contract declares.
    input: ['text'] as const,
    contextWindow: 128_000,
    maxTokens: 8_192,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  }))

/**
 * Turn a content-free settlement into a failure the retry policy can act on.
 *
 * pi-ai settles a reasoning-only response as `stopReason: 'stop'` with no
 * model-visible content. DSH reads that as a finished turn, the goal-round
 * driver reads a finished turn as "start the next round", and a degraded
 * provider then spends the entire round budget producing nothing. The transport
 * has no vocabulary for "this attempt failed", so the boundary raises one.
 *
 * Both stream shapes are wrapped, not just completions: the Responses API can
 * produce the same reasoning-only settlement on a different route.
 */
const rejectEmptyCompletion = <Streams extends { stream: (...args: never[]) => AsyncIterable<unknown> }>(api: Streams): Streams => {
  const original = api.stream.bind(api)
  return {
    ...api,
    stream: (...args: never[]) => {
      const source = original(...args)
      return {
        async *[Symbol.asyncIterator]() {
          for await (const raw of source) {
            const event = raw as { type?: string; message?: unknown }
            if (event.type === 'done') {
              // The settled message is the only authority here. Tracking deltas
              // instead would count a whitespace-only text_delta as an answer and
              // short-circuit the check that exists to catch exactly that.
              const settled = event.message as
                | { content?: readonly { type?: string; text?: string }[]; stopReason?: string; model?: string; rawStopReason?: string }
                | undefined
              if (isEmptyCompletion(settled)) {
                throw new LlmError(
                  describeEmptyResponse({
                    model: settled?.model,
                    stopReason: settled?.stopReason,
                    rawStopReason: settled?.rawStopReason,
                  }),
                  EMPTY_RESPONSE_CODE,
                )
              }
            }
            yield raw
          }
        },
      }
    },
  } as Streams
}

export const createCommandCodeProvider = (options: CommandCodeProviderOptions = {}) => {
  const base = providerBase(options.baseUrl)
  const keyEnv = resolveKeyEnv(options.keyEnv)
  return createProvider({
    id: COMMANDCODE_KIND,
    name: 'Command Code',
    baseUrl: base,
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
          if (credential?.key !== undefined && credential.key.length > 0) {
            return { auth: { apiKey: credential.key }, source: 'stored credential' }
          }
          const value = await ctx.env(keyEnv)
          signal.throwIfAborted()
          return value === undefined || value.length === 0 ? undefined : { auth: { apiKey: value }, source: keyEnv }
        },
      },
    },
    models: modelsFor(FALLBACK, base),
    // pi-ai calls this during a catalog refresh and owns persistence of the
    // result, so it only has to answer with the models it advertises now.
    fetchModels: async () => {
      const apiKey = options.resolveCredential === undefined ? readKeyFromEnv(keyEnv) : await options.resolveCredential(keyEnv)
      return modelsFor(await fetchCommandCodeCatalog({ baseUrl: options.baseUrl, apiKey }), base)
    },
    api: {
      'openai-completions': rejectEmptyCompletion(openAICompletionsApi()),
      'openai-responses': rejectEmptyCompletion(openAIResponsesApi()),
    },
  })
}
