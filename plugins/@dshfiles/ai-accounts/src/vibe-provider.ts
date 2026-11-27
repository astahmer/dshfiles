import { createProvider, type Model } from '@earendil-works/pi-ai'
import type { createMistralProvider } from './mistral-provider.js'
import { VIBE_CLI_TOKEN, type VibeCliSessions } from './vibe-cli.js'
import { VIBE_KIND, VibeAccountModel } from './vibe-account.js'

const VIBE_API = 'vibe-cli'

/**
 * The pi-ai provider behind every Vibe account. The CLI's own catalog decides which models exist and which thinking
 * levels each offers; the limits and prices are Mistral's published model figures from pi-ai's Mistral catalog, since
 * a plan draws an included allowance rather than per-token billing.
 */
export const createVibeProvider = (input: { readonly upstream: ReturnType<typeof createMistralProvider>; readonly sessions: VibeCliSessions }) => {
  const catalog = input.upstream.getModels()
  const models = VibeAccountModel.models.flatMap((entry): Model<string>[] => {
    const template =
      catalog.find(model => model.id === entry.id) ??
      catalog.find(model => model.id.startsWith(`${entry.id}-`)) ??
      catalog.find(model => model.id === 'mistral-medium-latest')
    if (template === undefined) return []
    return [
      {
        id: entry.id,
        name: entry.name,
        api: VIBE_API,
        provider: VIBE_KIND,
        baseUrl: '',
        input: entry.vision ? [...TEXT_AND_IMAGE] : ['text'],
        cost: template.cost,
        contextWindow: entry.contextWindow,
        maxTokens: template.maxTokens,
        reasoning: true,
        thinkingLevelMap: VibeAccountModel.thinkingLevelMap(entry.thinking),
      },
    ]
  })
  return createProvider({
    id: VIBE_KIND,
    name: 'Mistral Vibe CLI',
    auth: { apiKey: { name: 'Mistral Vibe CLI login', resolve: async () => ({ auth: { apiKey: VIBE_CLI_TOKEN }, source: 'vibe --setup' }) } },
    models,
    api: {
      stream: (model, context, options) => input.sessions.stream(model, context, options),
      streamSimple: (model, context, options) => input.sessions.stream(model, context, options),
    },
  })
}

const TEXT_AND_IMAGE = ['text', 'image'] as const
