import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { z } from 'zod'
import { backlogApi } from './api.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import { BacklogModel, backlogDomain, type BacklogActor, type BacklogStore } from './store.js'
import { BacklogTriage, type TriageQuestion, type TriageServices } from './triage.js'

interface OpenedBacklog {
  readonly store: BacklogStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: the API handlers and the setup effect receive
 * different contexts, and a second store would allocate the same ids.
 */
let opening: Promise<OpenedBacklog> | undefined

const openBacklog = async (ctx: Context): Promise<OpenedBacklog> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Backlog storage is unavailable.')
  const domain = await storage.open(backlogDomain)
  return { store: BacklogModel.createStore({ items: domain.table('items') }), close: () => domain.close() }
}

const backlogFor = (ctx: Context): Promise<BacklogStore> => {
  if (opening === undefined) {
    const started = openBacklog(ctx)
    opening = started
    void started.catch(() => {
      if (opening === started) opening = undefined
    })
  }
  return opening.then(opened => opened.store)
}

const closeBacklog = async (): Promise<void> => {
  if (opening === undefined) return
  const opened = await opening.then(
    value => value,
    () => undefined,
  )
  opening = undefined
  if (opened === undefined) return
  await opened.store.flush()
  await opened.close()
}

let settingsScope: SettingsScope<BacklogSettings> | undefined
const defaultSettings: BacklogSettings = backlogSettings.schema({})

const currentSettings = (): BacklogSettings => {
  try {
    return settingsScope?.get() ?? defaultSettings
  } catch {
    return defaultSettings
  }
}

const ownedSettings = backlogSettings.host({
  setup: scope => {
    settingsScope = scope
    return () => {
      if (settingsScope === scope) settingsScope = undefined
    }
  },
})

const jevAnswerSchema = z.object({ answers: z.object({ verdict: z.object({ type: z.literal('noul'), noul: z.number().min(0).max(1) }) }) })

/** TypeSafe's Jev (`POST /v1/systemone`) with one Noul question; the probability that the answer is "true". */
const askJev = async (request: { readonly apiKey: string; readonly question: TriageQuestion; readonly text: string }): Promise<number> => {
  const response = await fetch('https://api.typesafe.ai/v1/systemone', {
    method: 'POST',
    headers: { authorization: `Bearer ${request.apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      model: 'jev-latest',
      state: { role: 'user', content: request.text.slice(0, 8_000) },
      questions: { verdict: { type: 'noul', ...request.question } },
    }),
    signal: AbortSignal.timeout(4_000),
  })
  if (!response.ok) throw new Error(`Jev answered ${String(response.status)}`)
  return jevAnswerSchema.parse(await response.json()).answers.verdict.noul
}

const complete = async (
  ctx: Context,
  request: { readonly provider: string; readonly model: string; readonly system: string; readonly input: string },
): Promise<string> => {
  const llm = ctx.get('llm')
  if (llm === undefined) throw new Error('the DSH llm service is unavailable')
  const assembler = new BlockAssembler()
  const stream = llm.stream({
    provider: request.provider,
    model: request.model,
    system: request.system,
    messages: [createUserMessage({ content: [{ type: 'text', text: request.input }], source: { kind: 'user' } })],
    maxTokens: 512,
    purpose: 'compaction',
    signal: AbortSignal.timeout(30_000),
  })
  for await (const chunk of stream) assembler.push(chunk)
  if (assembler.finish.kind === 'error') throw new Error(assembler.finish.failure.message)
  return assembler
    .blocks()
    .flatMap(block => (block.type === 'text' ? [block.text] : []))
    .join('')
}

const triageServices = (ctx: Context, settings: BacklogSettings): TriageServices => {
  const apiKey = process.env['TYPESAFE_API_KEY']
  const jevReady = settings.jevEnabled && apiKey !== undefined && apiKey !== ''
  const modelReady = settings.triageProvider !== '' && settings.triageModel !== ''
  return {
    jev: jevReady ? request => askJev({ apiKey, ...request }) : undefined,
    complete: modelReady ? request => complete(ctx, { provider: settings.triageProvider, model: settings.triageModel, ...request }) : undefined,
  }
}

/** One pass on one item: a confident proposal applies as `system`, a hesitant one waits on the item. */
const triageItem = async (ctx: Context, id: number) => {
  const store = await backlogFor(ctx)
  const input = store.triageInput(id)
  if (input === undefined) return store.get(id)
  const settings = currentSettings()
  const proposal = await BacklogTriage.run({ ...input, services: triageServices(ctx, settings), now: Date.now() })
  if (proposal === null) return store.get(id)
  if (proposal.confidence >= settings.applyThreshold) return store.applyProposal({ id, proposal, actor: { kind: 'system' } })
  return store.propose({ id, proposal })
}

/** Background triage after a capture: the capture answers at once and never waits for Jev or the model. */
const scheduleTriage = (ctx: Context, id: number): void => {
  if (!currentSettings().autoTriage) return
  void triageItem(ctx, id).catch(error =>
    console.error('Backlog triage failed', { id, error: error instanceof Error ? error.message.slice(0, 200) : String(error) }),
  )
}

const actorOf = (caller: ApiCaller): BacklogActor =>
  caller.kind === 'agent' ? { kind: 'agent', sessionId: caller.sessionId, cwd: caller.cwd } : { kind: 'user' }

const backlogApiHost = backlogApi.host({
  list: async ({ ctx, input }) => (await backlogFor(ctx)).list(input),
  get: async ({ ctx, input }) => (await backlogFor(ctx)).get(input.id),
  referencing: async ({ ctx, input }) => (await backlogFor(ctx)).referencing(input),
  capture: async ({ ctx, input, caller }) => {
    const detail = await (await backlogFor(ctx)).capture({ ...input, actor: actorOf(caller) })
    scheduleTriage(ctx, detail.item.id)
    return detail
  },
  triage: async ({ ctx, input }) => triageItem(ctx, input.id),
  applyProposal: async ({ ctx, input, caller }) => (await backlogFor(ctx)).applyProposal({ id: input.id, actor: actorOf(caller) }),
  dismissProposal: async ({ ctx, input, caller }) => (await backlogFor(ctx)).dismissProposal({ id: input.id, actor: actorOf(caller) }),
  update: async ({ ctx, input, caller }) => (await backlogFor(ctx)).update({ ...input, actor: actorOf(caller) }),
  link: async ({ ctx, input, caller }) => (await backlogFor(ctx)).link({ ...input, actor: actorOf(caller) }),
  comment: async ({ ctx, input, caller }) => (await backlogFor(ctx)).comment({ ...input, actor: actorOf(caller) }),
})

export default defineHost({
  name: '@dshfiles/backlog',
  inject: ['storageDomain'],
  apis: [backlogApiHost],
  settings: [ownedSettings],
  setup: ctx => {
    ctx.effect(() => {
      void backlogFor(ctx).catch(() => undefined)
      return async () => {
        await closeBacklog()
      }
    }, 'backlog: item store')
  },
})
