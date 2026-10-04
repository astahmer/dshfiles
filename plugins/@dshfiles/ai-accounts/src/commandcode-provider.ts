import { createProvider, type Model } from '@earendil-works/pi-ai'
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy'
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy'

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
}

/**
 * A floor catalog so the route is usable before the live catalog is read. It is
 * deliberately small; the real list comes from {@link fetchCommandCodeCatalog}.
 */
const FALLBACK: readonly CatalogEntry[] = [
  { id: 'openai/gpt-5.1', api: 'openai-completions' },
  { id: 'anthropic/claude-sonnet-4-5', api: 'anthropic-messages' },
  { id: 'anthropic/claude-opus-4-1', api: 'anthropic-messages' },
  { id: 'google/gemini-3-pro', api: 'openai-completions' },
  { id: 'deepseek/deepseek-v3.2', api: 'openai-completions' },
]

const resolveBase = (baseUrl: string | undefined): string =>
  (baseUrl === undefined || baseUrl === '' ? DEFAULT_COMMANDCODE_BASE_URL : baseUrl).replace(
    /\/$/,
    '',
  )

/** Command Code serves its OpenAI-compatible routes under a provider prefix. */
const providerBase = (baseUrl: string | undefined): string => `${resolveBase(baseUrl)}/provider`

/**
 * Read the live catalog so the picker offers what the plan actually serves.
 *
 * Its Claude models are only served on the Messages shape, so that is declared
 * per model here rather than discovered from a failed request later.
 */
export const fetchCommandCodeCatalog = async (
  options: CommandCodeProviderOptions = {},
): Promise<readonly CatalogEntry[]> => {
  const base = resolveBase(options.baseUrl)
  const keyEnv =
    options.keyEnv === undefined || options.keyEnv === ''
      ? DEFAULT_COMMANDCODE_KEY_ENV
      : options.keyEnv
  const key = process.env[keyEnv]
  if (key === undefined || key.length === 0) return FALLBACK
  const response = await fetch(`${base}/provider/v1/models`, {
    headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
  })
  if (!response.ok) return FALLBACK
  const body = (await response.json()) as { data?: readonly { id?: string }[] }
  const entries = (body.data ?? [])
    .flatMap(entry => (typeof entry.id === 'string' && entry.id.length > 0 ? [entry.id] : []))
    .map(id => ({
      id,
      api: id.startsWith('anthropic/')
        ? ('anthropic-messages' as const)
        : ('openai-completions' as const),
    }))
  return entries.length === 0 ? FALLBACK : entries
}

const modelsFor = (
  entries: readonly CatalogEntry[],
  baseUrl: string,
): readonly Model<CommandCodeApi>[] =>
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

export const createCommandCodeProvider = (options: CommandCodeProviderOptions = {}) => {
  const base = providerBase(options.baseUrl)
  const keyEnv =
    options.keyEnv === undefined || options.keyEnv === ''
      ? DEFAULT_COMMANDCODE_KEY_ENV
      : options.keyEnv
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
          return value === undefined || value.length === 0
            ? undefined
            : { auth: { apiKey: value }, source: keyEnv }
        },
      },
    },
    models: modelsFor(FALLBACK, base),
    // pi-ai calls this during a catalog refresh and owns persistence of the
    // result, so it only has to answer with the models it advertises now.
    fetchModels: async () => modelsFor(await fetchCommandCodeCatalog(options), base),
    api: {
      'openai-completions': openAICompletionsApi(),
      'openai-responses': openAIResponsesApi(),
    },
  })
}