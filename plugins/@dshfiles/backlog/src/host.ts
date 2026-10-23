import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type { SessionCreateRequest, SessionRequestId } from '@deepseek-ai/dsh-api-session-controller'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { SessionEvent, TurnEndReason } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-storage-domain'
import type {} from '@deepseek-ai/dsh-subprocess'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import { agentsApi, type Agent } from '@dshfiles/agents/contract'
import { isApiOwnerMissing, PluginApiError, type ApiCaller } from '@dshfiles/dshx/api'
import { jjIntegrationApi } from '@dshfiles/jj-integration/api'
import { SecretReferenceResolver } from '@dshfiles/credential-port'
import { defineHost, definePromptSection } from '@dshfiles/dshx/host'
import type { SettingsScope } from '@dshfiles/dshx/settings'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { AgentComments } from './agent-dispatch.js'
import { backlogApi } from './api.js'
import { writeAttachmentFile } from './attachment-file.js'
import { BacklogBackfill, type TriageOutcome } from './backfill.js'
import { jevNeedsSecretSetup } from './jev-setup-status.js'
import { backlogSettings, type BacklogSettings } from './settings.js'
import type { BacklogEvent, BacklogItem } from './item.js'
import { StartThreadForm, startThreadItemOf } from './start-thread.js'
import { StartThreadPlacementPlan } from './start-thread-workspace.js'
import { BacklogModel, backlogDomain, backlogFileDomain, type BacklogActor, type BacklogStore } from './store.js'
import { BacklogProjectTarget } from './project-target.js'
import { BacklogSignals } from './signals.js'
import { ThreadLifecycle } from './thread-lifecycle.js'
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
  const attachments = await storage.open(backlogFileDomain)
  return {
    store: BacklogModel.createStore({
      items: domain.table('items'),
      files: attachments.table('files'),
      dormantDays: () => currentSettings().dormantAfterDays,
      onEvent: (item, event) => publishActivity(ctx, item, event),
    }),
    close: async () => {
      await domain.close()
      await attachments.close()
    },
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

const JEV_ENV_KEY = 'TYPESAFE_API_KEY'

/** The key Jev answers with, resolved on the Host from the bound reference or the environment. */
const jevApiKey = async (ctx: Context, settings: BacklogSettings): Promise<string | undefined> =>
  SecretReferenceResolver.resolve({
    referenceText: settings.jevSecret,
    values: ctx.get('secretCatalogValues'),
    environmentValue: process.env[JEV_ENV_KEY],
  })

/** The triage services the settings resolve to, and why they are missing when both are. */
const triageSetup = async (ctx: Context, settings: BacklogSettings): Promise<{ readonly services: TriageServices; readonly reason: string | null }> => {
  const apiKey = settings.jevEnabled ? await jevApiKey(ctx, settings) : undefined
  const jevReady = settings.jevEnabled && apiKey !== undefined
  const modelReady = settings.triageProvider !== '' && settings.triageModel !== ''
  return {
    services: {
      jev: jevReady ? request => askJev({ apiKey, ...request }) : undefined,
      complete: modelReady ? request => complete(ctx, { provider: settings.triageProvider, model: settings.triageModel, ...request }) : undefined,
    },
    reason:
      jevReady || modelReady
        ? null
        : settings.jevEnabled
          ? 'Jev is on but its key does not resolve: bind a TypeSafe secret or set TYPESAFE_API_KEY, or pick a triage model.'
          : 'Triage is off: turn on Jev or pick a triage provider and model in the Backlog settings.',
  }
}

type TriagePass = { readonly settings: BacklogSettings; readonly services: TriageServices }

/** One pass on one item: a confident proposal applies as `system`, a hesitant one waits on the item. */
const passTriage = async (ctx: Context, id: number, setup: TriagePass): Promise<TriageOutcome> => {
  const store = await backlogFor(ctx)
  const input = store.triageInput(id)
  if (input === undefined) return 'missing'
  const proposal = await BacklogTriage.run({ ...input, services: setup.services, now: Date.now() })
  if (proposal === null) return 'unchanged'
  if (proposal.confidence >= setup.settings.applyThreshold) {
    await store.applyProposal({ id, proposal, actor: { kind: 'system' } })
    return 'applied'
  }
  await store.propose({ id, proposal })
  return 'proposed'
}

const triageItem = async (ctx: Context, id: number) => {
  const store = await backlogFor(ctx)
  const settings = currentSettings()
  const setup = await triageSetup(ctx, settings)
  await passTriage(ctx, id, { settings, services: setup.services })
  return store.get(id)
}

/**
 * Runs triage over the items that existed before it was switched on: oldest open items that no triage looked at yet,
 * one at a time so a rate limit or a bad key does not burst. Nothing is triaged while both services are missing.
 */
interface BackfillJob {
  readonly jobId: string
  readonly retriage: boolean
  configured: boolean
  reason: string | null
  state: 'queued' | 'running' | 'completed' | 'failed'
  total: number
  completed: number
  applied: number
  proposed: number
  unchanged: number
  failed: number
  remaining: number
}

const backfillJobs = new Map<string, BackfillJob>()
const MAX_BACKFILL_JOBS = 20

const backfillSnapshot = (job: BackfillJob) => ({ ...job })

const backfillTriageStatus = (jobId: string) => {
  const job = backfillJobs.get(jobId)
  if (job !== undefined) return backfillSnapshot(job)
  return null
}

const backfillTriage = async (ctx: Context, request: { readonly retriage?: boolean | undefined; readonly limit?: number | undefined }) => {
  const jobId = randomUUID()
  const job: BackfillJob = {
    jobId,
    retriage: request.retriage === true,
    configured: true,
    reason: null,
    state: 'queued',
    total: 0,
    completed: 0,
    applied: 0,
    proposed: 0,
    unchanged: 0,
    failed: 0,
    remaining: 0,
  }
  const runningJob = Array.from(backfillJobs.values()).find(existingJob => existingJob.state === 'queued' || existingJob.state === 'running')
  if (runningJob !== undefined) throw new Error('A backlog backfill is already running.')
  if (backfillJobs.size >= MAX_BACKFILL_JOBS) {
    for (const [existingId, existingJob] of backfillJobs) {
      if (existingJob.state === 'completed' || existingJob.state === 'failed') backfillJobs.delete(existingId)
      if (backfillJobs.size < MAX_BACKFILL_JOBS) break
    }
  }
  if (backfillJobs.size >= MAX_BACKFILL_JOBS) throw new Error('Too many backfill jobs are active. Try again when one has finished.')
  backfillJobs.set(jobId, job)
  void (async () => {
    try {
      job.state = 'running'
      const settings = currentSettings()
      const setup = await triageSetup(ctx, settings)
      const store = await backlogFor(ctx)
      const scope = { retriage: request.retriage === true, limit: request.limit ?? BacklogBackfill.defaultLimit, statuses: BacklogBackfill.openStatuses }
      if (setup.reason !== null) {
        job.configured = false
        job.reason = setup.reason
        job.remaining = store.triageCandidates({ ...scope, limit: 0 }).total
        job.state = 'completed'
        return
      }
      const selection = store.triageCandidates(scope)
      job.total = selection.ids.length + selection.remaining
      job.remaining = selection.remaining
      const report = await BacklogBackfill.run({
        selection,
        triage: id =>
          passTriage(ctx, id, { settings, services: setup.services }).catch(error => {
            logFailure('Backlog backfill triage failed')(error)
            return 'failed' as const
          }),
        markTriaged: id => store.markTriaged(id),
        onProgress: progress => {
          job.completed = progress.completed + job.total - selection.ids.length
          job.applied = progress.applied
          job.proposed = progress.proposed
          job.unchanged = progress.unchanged
          job.failed = progress.failed
        },
      })
      job.remaining = report.remaining
      job.state = 'completed'
    } catch (error) {
      logFailure('Backlog backfill failed')(error)
      job.reason = 'The backfill failed before it could finish.'
      job.state = 'failed'
    }
  })()
  return { ...backfillSnapshot(job), state: 'queued' as const }
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
  if (event.kind === 'edited' && event.detail.startsWith('attention')) return 'backlog.attention'
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

/**
 * With `threadResolution` on and Jev configured, a finished reply can suggest closing the item it worked on: one Jev
 * question per open item, and never a status move on its own. Items the user touched or already dismissed are skipped.
 */
const scheduleResolution = (ctx: Context, session: Session, settings: BacklogSettings): void => {
  if (settings.threadResolution !== 'propose' || !settings.jevEnabled) return
  void (async () => {
    const store = await backlogFor(ctx)
    const open = store.referencing({ type: 'thread', target: session.id }).flatMap(item => {
      const detail = store.get(item.id)
      return detail.ok && ThreadLifecycle.openToResolution(detail.value.item) ? [detail.value.item] : []
    })
    if (open.length === 0) return
    const reply = ThreadLifecycle.replyText(session.deriveMessages())
    if (reply === '') return
    const apiKey = await jevApiKey(ctx, settings)
    if (apiKey === undefined) return
    for (const item of open) {
      const proposal = await BacklogTriage.resolveThread({ item, reply, jev: request => askJev({ apiKey, ...request }), now: Date.now() })
      if (proposal !== null) await store.propose({ id: item.id, proposal })
    }
  })().catch(logFailure('Backlog thread resolution failed'))
}

/** A thread that stopped flags the items it works on; its next finished turn clears only that same flag. */
const nudgeIdleThreads = async (ctx: Context): Promise<void> => {
  const settings = currentSettings()
  if (!settings.lifecycleSignals || settings.idleThreadNudgeDays === 0) return
  const store = await backlogFor(ctx)
  const items = store.list({ freshness: 'all', statuses: ['doing'], limit: 2_000 }).items.flatMap(summary => {
    const detail = store.get(summary.id)
    return detail.ok ? [detail.value.item] : []
  })
  if (items.length === 0) return
  const sessions = await ctx.sessionController.list({}, AbortSignal.timeout(20_000))
  for (const nudge of ThreadLifecycle.idleThreadNudges({ items, sessions: sessions.items, now: Date.now(), idleDays: settings.idleThreadNudgeDays })) {
    await store.applyThreadAttention({
      id: nudge.id,
      threadId: nudge.threadId,
      attention: 'waiting',
      reason: `Thread idle nudge: linked thread ${nudge.threadId} has been idle for at least ${settings.idleThreadNudgeDays} days. Is this item still active?`,
    })
  }
}

const onThreadTurn = (ctx: Context, session: Session, reason: TurnEndReason): void => {
  const outcome = ThreadLifecycle.outcome(reason)
  if (outcome === null) return
  void backlogFor(ctx)
    .then(async store => {
      for (const item of store.referencing({ type: 'thread', target: session.id }))
        await store.applyThreadAttention({ id: item.id, threadId: session.id, attention: outcome.stalled ? 'blocked' : 'none', reason: outcome.reason })
    })
    .catch(logFailure('Backlog thread lifecycle signal failed'))
  if (!outcome.stalled) scheduleResolution(ctx, session, currentSettings())
}

/** A user naming `b:12` in a thread is working on it: link the thread and start the item. */
const onSessionEvent = (ctx: Context, session: Session, event: SessionEvent): void => {
  if (!currentSettings().lifecycleSignals) return
  if (event.type === 'turn/end') {
    onThreadTurn(ctx, session, event.data.reason)
    return
  }
  if (event.type !== 'user/message' || event.data.source.kind !== 'user') return
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

/**
 * The project a capture made in `cwd` belongs to. A thread workspace is whatever jj says was cut from a project, so a
 * custom threads directory or a legacy workspace name still files the item under its project; without jj-integration,
 * or for a folder no workspace claims, the path stays as the caller gave it.
 */
const captureProjectOf = async (ctx: Context, cwd: string): Promise<string> => {
  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) return cwd
  const workspaces = registry.list()
  const jj = createHostApiClient(ctx, jjIntegrationApi, '@dshfiles/backlog')
  return BacklogProjectTarget.of(cwd, {
    workspaceAt: async path => {
      // A session may run in a subdirectory, so the deepest workspace holding the path owns it.
      const holder = workspaces
        .filter(candidate => path === candidate.path || path.startsWith(`${candidate.path}/`))
        .sort((left, right) => right.path.length - left.path.length)[0]
      return holder === undefined ? undefined : { id: holder.id, path: holder.path }
    },
    projectOf: async workspaceId => {
      const destination = await jj.safe.destination({ workspaceId })
      if (!destination.ok) {
        if (!isApiOwnerMissing(destination.error)) logFailure('Backlog project target failed')(destination.error)
        return null
      }
      const projectId = destination.value.projectWorkspaceId
      const project = projectId === null ? undefined : workspaces.find(candidate => candidate.id === projectId)
      return project === undefined ? null : { path: project.path }
    },
  })
}

const speechStatusOf = (ctx: Context) => {
  const speech = ctx.get('speechToText')
  if (speech === undefined) {
    return { available: false, ready: false, provider: null, language: null, reason: 'The voice-input bundle is not loaded.' }
  }
  try {
    const snapshot = speech.snapshot()
    const provider = snapshot.providers.find(candidate => candidate.id === snapshot.selection.providerId)
    if (provider === undefined) {
      return { available: true, ready: false, provider: null, language: snapshot.selection.language, reason: 'The selected recognizer is not registered.' }
    }
    const phase = provider.preparation?.phase
    return {
      available: true,
      ready: phase === 'ready',
      provider: provider.name,
      language: snapshot.selection.language,
      reason: phase === 'ready' ? null : 'Open Plugins → Voice input to prepare the recognizer.',
    }
  } catch (error) {
    return {
      available: true,
      ready: false,
      provider: null,
      language: null,
      reason: error instanceof Error ? error.message.slice(0, 300) : 'Speech readiness is unavailable.',
    }
  }
}

const transcribeSpeech = async (
  ctx: Context,
  audioBase64: string,
  signal: AbortSignal,
): Promise<{ ok: true; text: string } | { ok: false; reason: string }> => {
  const speech = ctx.get('speechToText')
  if (speech === undefined) return { ok: false, reason: 'The voice-input bundle is not loaded.' }
  const status = speechStatusOf(ctx)
  if (!status.ready) return { ok: false, reason: status.reason ?? 'The recognizer is not ready.' }
  try {
    const audio = new Uint8Array(Buffer.from(audioBase64, 'base64'))
    if (audio.byteLength === 0) return { ok: false, reason: 'The recording was empty.' }
    const spec = speech.resolve({ audio })
    const transcript = await speech.transcribe(spec, signal)
    return { ok: true, text: transcript.text }
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message.slice(0, 300) : 'Transcription failed.' }
  }
}

/** The opening message carries the same bounded preview the list shows, not a whole body. */
const PREVIEW_CHARS = 280

/**
 * The workspace a started thread runs in: jj-integration cuts a thread workspace from the project, and answers the
 * workspace unchanged outside a jj repository. Only a missing plugin is no error, because then the project checkout is
 * all the Host has to offer.
 */
const isolatedWorkspaceOf = async (ctx: Context, workspaceId: string): Promise<WorkspaceId> => {
  const jj = createHostApiClient(ctx, jjIntegrationApi, '@dshfiles/backlog')
  const provisioned = await jj.safe.provision({ workspaceId, isolate: true })
  if (!provisioned.ok && !isApiOwnerMissing(provisioned.error)) {
    throw new PluginApiError(`The thread workspace could not be created: ${provisioned.error.message}`, { code: 'workspace-failed' })
  }
  // SAFETY: both ids come from the Host workspace registry, the same identity the Session controller takes branded.
  return (provisioned.ok ? provisioned.value.workspaceId : workspaceId) as WorkspaceId
}

/** The agent a start names, refused when it is unknown or disabled so the thread is not started as the wrong one. */
const agentForStart = async (ctx: Context, handle: string): Promise<Agent> => {
  const agents = createHostApiClient(ctx, agentsApi, '@dshfiles/backlog')
  const found = await agents.safe.get({ handle })
  if (!found.ok) throw new PluginApiError(`The agent registry could not be read: ${found.error.message}`, { code: 'agents-unavailable' })
  const agent = found.value.agent
  if (agent === null) throw new PluginApiError(`No agent is saved as @${handle}.`, { code: 'agent-not-found' })
  if (!agent.enabled) throw new PluginApiError(`Agent @${handle} is disabled.`, { code: 'agent-disabled' })
  return agent
}

/**
 * One thread for the items a caller named: its own jj workspace of their project, the agent's or the caller's model, the
 * first message, and every item link. The panel and `backlog_start_thread` share this, so a thread an agent starts is
 * the same thread the dialog starts.
 */
const startThreadForItems = async (
  ctx: Context,
  input: {
    readonly ids: readonly number[]
    readonly workspaceId?: string | undefined
    readonly cwd?: string | undefined
    readonly agent?: string | undefined
    readonly provider?: string | undefined
    readonly model?: string | undefined
    readonly reasoningEffort?: string | undefined
    readonly message?: string | undefined
  },
  caller: ApiCaller,
): Promise<{ readonly sessionId: string; readonly linked: number[]; readonly missing: number[] }> => {
  const store = await backlogFor(ctx)
  const { items, missing } = store.getMany(input.ids)
  if (items.length === 0) {
    throw new PluginApiError(`No backlog item matched ${input.ids.map(id => `b:${String(id)}`).join(', ')}.`, { code: 'item-not-found' })
  }
  const agent = input.agent === undefined ? null : await agentForStart(ctx, input.agent)
  const details = items.map(detail => startThreadItemOf({ ...detail.item, preview: detail.item.body.slice(0, PREVIEW_CHARS) }))
  const heading = StartThreadForm.message(details)
  const raw = input.message ?? heading
  const message = agent === null ? raw : AgentComments.opening(agent, raw)
  const placement = StartThreadPlacementPlan.of({
    workspaceId: input.workspaceId,
    cwd: input.cwd,
    registered: (ctx.get('workspaceRegistry')?.list() ?? []).map(workspace => ({ id: workspace.id, path: workspace.path })),
    itemProjects: items.map(detail => detail.item.project),
  })
  const base: SessionCreateRequest =
    placement.workspaceId === undefined
      ? placement.cwd === undefined
        ? {}
        : { cwd: placement.cwd }
      : { workspaceId: await isolatedWorkspaceOf(ctx, placement.workspaceId) }
  const controller = ctx.get('sessionController')
  if (controller === undefined)
    throw new PluginApiError('The Host session controller is unavailable, so no thread can be started.', { code: 'sessions-unavailable' })
  const created = await controller.create(agent?.preset == null ? base : { ...base, agentPreset: agent.preset })
  const sessionId = created.sessionId
  const route =
    agent?.route ??
    (input.provider === undefined || input.model === undefined
      ? null
      : { provider: input.provider, model: input.model, reasoningEffort: input.reasoningEffort })
  if (route !== null) {
    try {
      await controller.selectModel(
        route.reasoningEffort === undefined
          ? { sessionId, provider: route.provider, model: route.model }
          : { sessionId, provider: route.provider, model: route.model, reasoningEffort: route.reasoningEffort },
      )
    } catch (error) {
      logFailure('Backlog thread kept the Host default model')(error)
    }
  }
  try {
    await controller.rename({ sessionId, title: StartThreadForm.title(details) })
  } catch (error) {
    logFailure('Backlog thread kept its created title')(error)
  }
  if (message !== '') {
    try {
      // SAFETY: SessionRequestId is a type-only brand over a Host-minted unique id.
      const requestId = randomUUID() as SessionRequestId
      await controller.prompt({ requestId, sessionId, mode: 'queue', content: [{ type: 'text', text: message }] }, AbortSignal.timeout(30_000))
    } catch (error) {
      logFailure('Backlog thread started without its first message')(error)
    }
  }
  const actor = actorOf(caller)
  const linked: number[] = []
  for (const detail of items) {
    const result = await store.link({
      id: detail.item.id,
      link: { type: 'thread', target: sessionId, provenance: caller.kind === 'agent' ? 'agent' : 'user' },
      actor,
    })
    if (result.ok) linked.push(detail.item.id)
    else logFailure(`Backlog item b:${String(detail.item.id)} was not linked to its thread`)(result.reason)
  }
  return { sessionId, linked, missing }
}

const backlogApiHost = backlogApi.host({
  list: async ({ ctx, input }) => (await backlogFor(ctx)).list(input),
  get: async ({ ctx, input }) => (await backlogFor(ctx)).get(input.id),
  getMany: async ({ ctx, input }) => (await backlogFor(ctx)).getMany(input.ids),
  revision: async ({ ctx }) => (await backlogFor(ctx)).revision(),
  projects: async ({ ctx }) => (await backlogFor(ctx)).projects().map(entry => ({ ...entry, counts: { ...entry.counts }, actors: [...entry.actors] })),
  referencing: async ({ ctx, input }) => (await backlogFor(ctx)).referencing(input),
  capture: async ({ ctx, input, caller }) => {
    const actor = actorOf(caller)
    const project = input.project === undefined && actor.kind === 'agent' && actor.cwd !== undefined ? await captureProjectOf(ctx, actor.cwd) : input.project
    const captureInput = { ...input, actor }
    if (project !== undefined) captureInput.project = project
    const detail = await (await backlogFor(ctx)).capture(captureInput)
    scheduleTriage(ctx, detail.item.id)
    return detail
  },
  triage: async ({ ctx, input }) => triageItem(ctx, input.id),
  backfillTriage: async ({ ctx, input }) => backfillTriage(ctx, input),
  backfillTriageStatus: async ({ input }) => backfillTriageStatus(input.jobId),
  acknowledge: async ({ ctx, input }) => (await backlogFor(ctx)).acknowledge(input),
  applyProposal: async ({ ctx, input, caller }) => (await backlogFor(ctx)).applyProposal({ id: input.id, actor: actorOf(caller) }),
  dismissProposal: async ({ ctx, input, caller }) => (await backlogFor(ctx)).dismissProposal({ id: input.id, actor: actorOf(caller) }),
  attachFile: async ({ ctx, input, caller }) => (await backlogFor(ctx)).attachFile({ id: input.id, file: input.file, actor: actorOf(caller) }),
  readFile: async ({ ctx, input }) => {
    const result = await (await backlogFor(ctx)).readFile(input)
    if (!result.ok || input.save !== true) return result
    const path = await writeAttachmentFile({ id: input.id, attachmentId: input.attachmentId, dataUrl: result.value.dataUrl })
    return { ok: true, value: { dataUrl: result.value.dataUrl, path } }
  },
  removeFile: async ({ ctx, input, caller }) => (await backlogFor(ctx)).removeFile({ ...input, actor: actorOf(caller) }),
  delete: async ({ ctx, input }) => {
    const result = await (await backlogFor(ctx)).delete(input)
    return result.ok ? { ok: true } : result
  },
  speechStatus: ({ ctx }) => speechStatusOf(ctx),
  jevSetupStatus: async ({ ctx }) => {
    const settings = currentSettings()
    return {
      needsSetup: await jevNeedsSecretSetup({ enabled: settings.jevEnabled, resolveKey: () => jevApiKey(ctx, settings) }),
    }
  },
  transcribeSpeech: async ({ ctx, input, signal }) => transcribeSpeech(ctx, input.audioBase64, signal),
  update: async ({ ctx, input, caller }) => (await backlogFor(ctx)).update({ ...input, actor: actorOf(caller) }),
  link: async ({ ctx, input, caller }) => (await backlogFor(ctx)).link({ ...input, actor: actorOf(caller) }),
  startThread: async ({ ctx, input, caller }) => startThreadForItems(ctx, input, caller),
  comment: async ({ ctx, input, caller }) => (await backlogFor(ctx)).comment({ ...input, actor: actorOf(caller) }),
})

/**
 * What every Agent needs to know about the items it is working on, whichever thread it was started in: the panel only
 * links and starts an item, so finishing it is the Agent's call, and so is saying what is left.
 */
const itemLifecycleSection = definePromptSection({
  name: 'dshfiles-backlog:item-lifecycle',
  order: 910,
  text: [
    'Backlog: a thread naming `b:12` links that item and moves it to `doing`. Keep it current while you work: move it to',
    '`done` with `backlog_update` once the thread has resolved it. When only part of it is done, or the work is stuck,',
    'leave it `doing`, add a `partial` or `blocked` tag, set `attention` when the user must decide something,',
    '`backlog_comment` what is done and what is missing, and say the same in your final reply.',
  ].join(' '),
})

export default defineHost({
  name: '@dshfiles/backlog',
  inject: ['storageDomain', 'sessionController'],
  apis: [backlogApiHost],
  prompts: [itemLifecycleSection],
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
      let lastNudge = 0
      const timer = setInterval(() => {
        const settings = currentSettings()
        if (!settings.lifecycleSignals || settings.idleThreadNudgeDays === 0 || Date.now() - lastNudge < 60 * 60_000) return
        lastNudge = Date.now()
        void nudgeIdleThreads(ctx).catch(logFailure('Backlog idle-thread nudge failed'))
      }, 60_000)
      return () => clearInterval(timer)
    }, 'backlog: idle thread nudges')
    ctx.effect(() => {
      void backlogFor(ctx).catch(() => undefined)
      return async () => {
        await closeBacklog()
      }
    }, 'backlog: item store')
  },
})
