import type { Context } from '@deepseek-ai/cordis'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type { ApiCaller } from '@dshfiles/dshx/api'
import { defineHost } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { z } from 'zod'
import { backlogApi } from './api.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import type { BacklogEvent, BacklogItem } from './item.js'
import { BacklogModel, backlogDomain, type BacklogActor, type BacklogStore } from './store.js'
import { BacklogSignals } from './signals.js'
import { BacklogTriage, type TriageQuestion, type TriageServices } from './triage.js'

interface OpenedBacklog {
  readonly store: BacklogStore
  readonly close: () => Promise<void>
}

/**
 * One store per Host process, not per Cordis context: the API handlers and the setup effect receive
 * different contexts, and a second store would allocate the same ids.
 */
/** The `backlog` kind of `@dshfiles/activity-timeline`'s ingest event, matching its `backlogActivitySchema`. */
interface BacklogActivityPayload {
  readonly kind: 'backlog'
  readonly value: {
    readonly id: string
    readonly at: number
    readonly type: 'backlog.created' | 'backlog.moved' | 'backlog.linked' | 'backlog.commented' | 'backlog.attention' | 'backlog.triaged'
    readonly level: 'routine' | 'notable' | 'attention'
    readonly summary: string
    readonly detail: string | null
    readonly itemId: number
    readonly sessionId: string | null
    readonly revision: string | null
  }
}

declare module '@deepseek-ai/cordis' {
  interface Events {
    'dshfiles/activity/event'(payload: BacklogActivityPayload): void
  }
}

let opening: Promise<OpenedBacklog> | undefined

const openBacklog = async (ctx: Context): Promise<OpenedBacklog> => {
  const storage = ctx.get('storageDomain')
  if (storage === undefined) throw new Error('Backlog storage is unavailable.')
  const domain = await storage.open(backlogDomain)
  return {
    store: BacklogModel.createStore({
      items: domain.table('items'),
      dormantDays: () => currentSettings().dormantAfterDays,
      onEvent: (item, event) => publishActivity(ctx, item, event),
    }),
    close: () => domain.close(),
  }
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

const logFailure = (what: string) => (error: unknown) => console.error(what, { error: error instanceof Error ? error.message.slice(0, 200) : String(error) })

const activityType = (
  event: BacklogEvent,
): 'backlog.created' | 'backlog.moved' | 'backlog.linked' | 'backlog.commented' | 'backlog.attention' | 'backlog.triaged' | null => {
  if (event.kind === 'created') return 'backlog.created'
  if (event.kind === 'moved') return 'backlog.moved'
  if (event.kind === 'linked') return 'backlog.linked'
  if (event.kind === 'commented') return 'backlog.commented'
  if (event.kind === 'triaged') return 'backlog.triaged'
  if (event.kind === 'edited' && event.detail === 'attention') return 'backlog.attention'
  return null
}

/** One timeline event per meaningful change; plain edits (titles, tags, unlinks) stay in the item's own history. */
const publishActivity = (ctx: Context, item: BacklogItem, event: BacklogEvent): void => {
  const type = activityType(event)
  if (type === null || !currentSettings().publishActivity) return
  const attention = item.attention ?? 'none'
  const sessionId = event.actor.startsWith('agent:') ? event.actor.slice('agent:'.length) : null
  const revision = /^(?:\S+ )?revision:(\S+)/.exec(event.detail)?.[1] ?? /closed by jj:(\S+)\)$/.exec(event.detail)?.[1] ?? null
  const phrase =
    type === 'backlog.attention'
      ? attention === 'none'
        ? 'cleared the request on'
        : attention === 'needs-input'
          ? 'asked for your input on'
          : `marked ${attention}`
      : type.slice('backlog.'.length)
  ctx.emit('dshfiles/activity/event', {
    kind: 'backlog',
    value: {
      id: `backlog:${String(item.id)}:${String(event.at)}:${event.kind}`,
      at: event.at,
      type,
      level:
        type === 'backlog.attention' && attention !== 'none' ? 'attention' : type === 'backlog.moved' || type === 'backlog.created' ? 'notable' : 'routine',
      summary:
        `${event.actor === 'user' ? 'You' : event.actor === 'system' ? 'Automatic' : `Agent ${(sessionId ?? '').replace(/^session-/, '').slice(0, 6)}`} ${phrase} b:${String(item.id)} ${item.title}`.slice(
          0,
          500,
        ),
      detail: event.kind === 'commented' || event.kind === 'moved' ? event.detail.slice(0, 2_000) : null,
      itemId: item.id,
      sessionId,
      revision,
    },
  })
}

/** Background triage after a capture: the capture answers at once and never waits for Jev or the model. */
const scheduleTriage = (ctx: Context, id: number): void => {
  if (!currentSettings().autoTriage) return
  void triageItem(ctx, id).catch(logFailure('Backlog triage failed'))
}

/** A user naming `b:12` in a thread is working on it: link the thread and start the item. */
const onSessionEvent = (ctx: Context, session: { readonly id: string }, event: SessionEvent): void => {
  if (!currentSettings().lifecycleSignals || event.type !== 'user/message' || event.data.source.kind !== 'user') return
  const ids = BacklogSignals.mentionsIn(event.data.content.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('\n'))
  if (ids.length === 0) return
  void backlogFor(ctx)
    .then(store =>
      Promise.all(ids.map(id => store.applySignal({ id, status: 'doing', link: { type: 'thread', target: session.id }, reason: 'mentioned in a thread' }))),
    )
    .catch(logFailure('Backlog thread signal failed'))
}

/** Read-only and bounded: `--ignore-working-copy` never snapshots anyone's checkout. */
const runJj = async (ctx: Context, cwd: string, args: readonly string[]): Promise<string> => {
  const subprocess = ctx.get('subprocess')
  if (subprocess === undefined) throw new Error('the DSH subprocess service is unavailable')
  const binary = await subprocess.resolveExecutable('jj', undefined, AbortSignal.timeout(5_000))
  const handle = subprocess.spawn({
    argv: [binary, '--color=never', '--no-pager', '--ignore-working-copy', ...args],
    cwd,
    stdio: { stdin: 'ignore', stdout: { maxBytes: 400_000 }, stderr: { maxBytes: 4_000 } },
    graceMs: 1_500,
    signal: AbortSignal.timeout(20_000),
  })
  const outcome = await handle.done
  if (outcome.exitCode !== 0) throw new Error(`jj exited ${String(outcome.exitCode)} in ${cwd}`)
  return handle.collected.stdout?.readFrom(0)?.text ?? ''
}

const MAX_REPOSITORIES = 10
const seenMain = new Map<string, string>()

/** Finish items that a revision on main closes (`Closes b:12`), in every repository an open item names. */
const pollRevisions = async (ctx: Context): Promise<void> => {
  const store = await backlogFor(ctx)
  const settings = currentSettings()
  const open = store.list({ freshness: 'all', statuses: ['inbox', 'todo', 'doing'], limit: 500 }).items
  const repositories = [...new Set([...settings.revisionRepositories, ...open.flatMap(item => (item.project === null ? [] : [item.project]))])].slice(
    0,
    MAX_REPOSITORIES,
  )
  for (const repository of repositories) {
    const head = await runJj(ctx, repository, ['log', '--no-graph', '-r', 'main', '-T', 'commit_id']).catch(() => undefined)
    if (head === undefined || seenMain.get(repository) === head) continue
    seenMain.set(repository, head)
    const log = await runJj(ctx, repository, ['log', '--no-graph', '-r', 'ancestors(main, 50) ~ root()', '-T', BacklogSignals.logTemplate]).catch(() => '')
    for (const revision of BacklogSignals.parseLog(log))
      for (const id of BacklogSignals.closedBy(revision.description))
        await store.applySignal({ id, status: 'done', link: { type: 'revision', target: revision.changeId }, reason: `closed by jj:${revision.changeId}` })
  }
}

const actorOf = (caller: ApiCaller): BacklogActor =>
  caller.kind === 'agent' ? { kind: 'agent', sessionId: caller.sessionId, cwd: caller.cwd } : { kind: 'user' }

const backlogApiHost = backlogApi.host({
  list: async ({ ctx, input }) => (await backlogFor(ctx)).list(input),
  get: async ({ ctx, input }) => (await backlogFor(ctx)).get(input.id),
  revision: async ({ ctx }) => (await backlogFor(ctx)).revision(),
  projects: async ({ ctx }) => (await backlogFor(ctx)).projects().map(entry => ({ ...entry, counts: { ...entry.counts }, actors: [...entry.actors] })),
  referencing: async ({ ctx, input }) => (await backlogFor(ctx)).referencing(input),
  capture: async ({ ctx, input, caller }) => {
    const detail = await (await backlogFor(ctx)).capture({ ...input, actor: actorOf(caller) })
    scheduleTriage(ctx, detail.item.id)
    return detail
  },
  triage: async ({ ctx, input }) => triageItem(ctx, input.id),
  acknowledge: async ({ ctx, input }) => (await backlogFor(ctx)).acknowledge(input),
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
    ctx.on('session/event', (session, event) => onSessionEvent(ctx, session, event))
    ctx.effect(() => {
      let lastPoll = 0
      // A one-minute tick so a changed poll interval applies without a restart.
      const timer = setInterval(() => {
        const settings = currentSettings()
        if (!settings.lifecycleSignals || Date.now() - lastPoll < settings.revisionPollMinutes * 60_000) return
        lastPoll = Date.now()
        void pollRevisions(ctx).catch(logFailure('Backlog revision signal failed'))
      }, 60_000)
      return () => clearInterval(timer)
    }, 'backlog: revision signals')
    ctx.effect(() => {
      void backlogFor(ctx).catch(() => undefined)
      return async () => {
        await closeBacklog()
      }
    }, 'backlog: item store')
  },
})
