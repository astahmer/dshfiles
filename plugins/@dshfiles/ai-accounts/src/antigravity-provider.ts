import type { LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import { createProvider, type Model, type ThinkingLevelMap } from '@earendil-works/pi-ai'
import type { AntigravityAcpSessions } from './antigravity-acp.js'
import { ANTIGRAVITY_CLI_TOKEN, ANTIGRAVITY_KIND, type AntigravityLevel, type AntigravityModelEntry } from './antigravity-account.js'

export const ANTIGRAVITY_API = 'antigravity-acp'

/**
 * Antigravity publishes no context or output limits; these are the vendors' documented limits per family (Gemini 1M
 * context, which `agy`'s `usage_update` also reports; Claude 200k; GPT-OSS 128k), and the model reads images unless
 * its family does not.
 */
const FAMILY_LIMITS: readonly { readonly prefix: string; readonly contextWindow: number; readonly maxTokens: number; readonly images: boolean }[] = [
  { prefix: 'gemini-', contextWindow: 1_048_576, maxTokens: 65_536, images: true },
  { prefix: 'claude-', contextWindow: 200_000, maxTokens: 64_000, images: true },
  { prefix: 'gpt-oss-', contextWindow: 131_072, maxTokens: 32_768, images: false },
]
const DEFAULT_LIMITS = { contextWindow: 1_048_576, maxTokens: 65_536, images: true }

const thinkingLevelMap = (levels: readonly AntigravityLevel[]): ThinkingLevelMap => {
  const offered = (level: AntigravityLevel): string | null => (levels.includes(level) ? level : null)
  return { off: null, minimal: null, low: offered('low'), medium: offered('medium'), high: offered('high'), xhigh: offered('xhigh'), max: offered('max') }
}

const describe = (id: string, name: string, levels: readonly AntigravityLevel[], discovered?: LlmDiscoveredModel): Model<string> => {
  const family = FAMILY_LIMITS.find(candidate => id.startsWith(candidate.prefix)) ?? DEFAULT_LIMITS
  return {
    id,
    name,
    api: ANTIGRAVITY_API,
    provider: ANTIGRAVITY_KIND,
    baseUrl: '',
    reasoning: levels.length > 0,
    ...(levels.length > 0 && { thinkingLevelMap: thinkingLevelMap(levels) }),
    input: discovered?.inputModalities !== undefined ? [...discovered.inputModalities] : family.images ? ['text', 'image'] : ['text'],
    // A Google AI plan bills no tokens; usage counts against its quota instead.
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: discovered?.contextWindow ?? family.contextWindow,
    maxTokens: discovered?.maxTokens ?? family.maxTokens,
  }
}

/**
 * The pi-ai provider behind every Antigravity account. It has no static catalog: each account's models come from its
 * own `agy` (see AntigravityAccountModel.describe), and `remember` keeps the thought levels `agy` offers per model.
 */
export const createAntigravityProvider = (sessions: AntigravityAcpSessions) => {
  const levels = new Map<string, readonly AntigravityLevel[]>()
  const provider = createProvider({
    id: ANTIGRAVITY_KIND,
    name: 'Antigravity',
    auth: { apiKey: { name: 'Antigravity CLI login', resolve: async () => ({ auth: { apiKey: ANTIGRAVITY_CLI_TOKEN }, source: 'agy login' }) } },
    models: [],
    api: {
      stream: (model, context, options) => sessions.stream(model, context, options),
      streamSimple: (model, context, options) => sessions.stream(model, context, options),
    },
  })
  return {
    ...provider,
    getModels: (): Model<string>[] => [],
    remember: (entries: readonly AntigravityModelEntry[]): void => {
      for (const entry of entries) levels.set(entry.id, entry.levels)
    },
    describeModel: (id: string, discovered?: LlmDiscoveredModel): Model<string> =>
      describe(id, discovered?.name ?? id, levels.get(id) ?? ['low', 'medium', 'high'], discovered),
  }
}
