import { createProvider, type AssistantMessageEventStream, type Model, type SimpleStreamOptions, type TranscriptContext } from '@earendil-works/pi-ai'
import type { createMistralProvider } from './mistral-provider.js'
import type { VibeAcpSessions } from './vibe-acp.js'
import { VIBE_CLI_TOKEN, type VibeCliSessions } from './vibe-cli.js'
import { VIBE_KIND, VibeAccountModel } from './vibe-account.js'

/** The headless CLI route: one `vibe --prompt-file` process per DSH step, no DSH tools. */
export const VIBE_CLI_API = 'vibe-cli'
/** The ACP bridge: one `vibe-acp` process per conversation, DSH's tools over MCP. */
export const VIBE_ACP_API = 'vibe-acp'

const TEXT_AND_IMAGE = ['text', 'image'] as const

/**
 * The pi-ai models every Vibe account publishes, under the API id of the transport that serves it. The CLI's own
 * catalog decides which models exist and which thinking levels each offers; the limits and prices are Mistral's
 * published model figures from pi-ai's Mistral catalog, since a plan draws an included allowance rather than
 * per-token billing.
 */
const vibeModels = (input: { readonly upstream: ReturnType<typeof createMistralProvider>; readonly api: string }): Model<string>[] => {
  const catalog = input.upstream.getModels()
  return VibeAccountModel.models.flatMap((entry): Model<string>[] => {
    const template =
      catalog.find(model => model.id === entry.id) ??
      catalog.find(model => model.id.startsWith(`${entry.id}-`)) ??
      catalog.find(model => model.id === 'mistral-medium-latest')
    if (template === undefined) return []
    return [
      {
        id: entry.id,
        name: entry.name,
        api: input.api,
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
}

/** What both Vibe transports expose to pi-ai: one DSH model step in, one assistant message event stream out. */
type VibeStream = (model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions | undefined) => AssistantMessageEventStream

const vibeProvider = (input: {
  readonly name: string
  readonly upstream: ReturnType<typeof createMistralProvider>
  readonly api: string
  readonly stream: VibeStream
}) =>
  createProvider({
    id: VIBE_KIND,
    name: input.name,
    auth: { apiKey: { name: 'Mistral Vibe CLI login', resolve: async () => ({ auth: { apiKey: VIBE_CLI_TOKEN }, source: 'vibe --setup' }) } },
    models: vibeModels({ upstream: input.upstream, api: input.api }),
    api: {
      [input.api]: {
        stream: (model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions | undefined) => input.stream(model, context, options),
        streamSimple: (model: Model<string>, context: TranscriptContext, options: SimpleStreamOptions | undefined) => input.stream(model, context, options),
      },
    },
  })

/** The pi-ai provider behind every Vibe account that runs the headless `vibe` CLI. */
export const createVibeProvider = (input: { readonly upstream: ReturnType<typeof createMistralProvider>; readonly sessions: VibeCliSessions }) =>
  vibeProvider({ name: 'Mistral Vibe CLI', upstream: input.upstream, api: VIBE_CLI_API, stream: input.sessions.stream.bind(input.sessions) })

/** The same catalog over the ACP transport: `vibe-acp` holds the conversation and runs DSH's tools. */
export const createVibeAcpProvider = (input: { readonly upstream: ReturnType<typeof createMistralProvider>; readonly sessions: VibeAcpSessions }) =>
  vibeProvider({ name: 'Mistral Vibe ACP', upstream: input.upstream, api: VIBE_ACP_API, stream: input.sessions.stream.bind(input.sessions) })
