import { assign, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'
import type { LandResult } from './api.js'
import { IntegrationRecovery } from './integration-recovery.js'

export type IntegrationJobPhase =
  | 'queued'
  | 'integrating'
  | 'validating'
  | 'rebasing'
  | 'integrated'
  | 'conflicts'
  | 'needs-description'
  | 'up-to-date'
  | 'failed'
export type ActiveIntegrationPhase = Extract<IntegrationJobPhase, 'queued' | 'validating' | 'rebasing'>
export type IntegrationJob = { readonly phase: IntegrationJobPhase; readonly message?: string | undefined }

export type IntegrationNotice =
  | { readonly kind: 'queued' }
  | { readonly kind: 'land-result'; readonly result: LandResult }
  | { readonly kind: 'failed'; readonly message: string }

export interface IntegrationProgressRead {
  readonly progress: { readonly phase: ActiveIntegrationPhase } | null
}

export interface IntegrationQueueClient {
  readonly land: (input: { readonly path: string; readonly signal: AbortSignal }) => Promise<LandResult>
  readonly integrationProgress: (input: { readonly path: string; readonly signal: AbortSignal }) => Promise<IntegrationProgressRead>
}

/** The Host records a landing phase while it works; one poll per interval keeps the row honest without a cache. */
const PROGRESS_POLL_MS = 350

interface IntegrationQueueContext {
  readonly client: IntegrationQueueClient
  readonly queue: readonly string[]
  readonly activePath: string | null
  readonly jobs: ReadonlyMap<string, IntegrationJob>
  readonly notice: IntegrationNotice | null
}

interface IntegrationQueueInput {
  readonly client: IntegrationQueueClient
}

type IntegrationQueueEvent =
  | { readonly type: 'start'; readonly paths: readonly string[] }
  | { readonly type: 'progress'; readonly path: string; readonly phase: ActiveIntegrationPhase }

const setJob = (jobs: ReadonlyMap<string, IntegrationJob>, path: string, job: IntegrationJob): ReadonlyMap<string, IntegrationJob> =>
  new Map(jobs).set(path, job)

const noticeForResult = (result: LandResult): IntegrationNotice | null => (result.status === 'landed' ? null : { kind: 'land-result', result })

const noticeForFailure = (error: unknown): IntegrationNotice =>
  IntegrationRecovery.isQueued(error) ? { kind: 'queued' } : { kind: 'failed', message: errorMessage(error, '') }

const jobForResult = (result: LandResult): IntegrationJob => {
  if (result.status === 'landed') return { phase: 'integrated' }
  if (result.status === 'conflicted') return { phase: 'conflicts', message: result.files.join(', ') }
  if (result.status === 'needs-description') return { phase: 'needs-description', message: result.revisions.map(revision => revision.changeId).join(', ') }
  return { phase: 'up-to-date' }
}

const queuedJobs = (current: ReadonlyMap<string, IntegrationJob>, paths: readonly string[]): ReadonlyMap<string, IntegrationJob> => {
  const jobs = new Map<string, IntegrationJob>(current)
  for (const path of paths) jobs.set(path, { phase: 'queued' })
  return jobs
}

const advanceQueue = (context: IntegrationQueueContext, job: IntegrationJob, notice: IntegrationNotice | null): Partial<IntegrationQueueContext> => {
  const activePath = context.queue[0]
  if (activePath === undefined) return { activePath: null, queue: [], notice }
  return { activePath: null, queue: context.queue.slice(1), jobs: setJob(context.jobs, activePath, job), notice }
}

// SAFETY: XState's `types` entries are empty type carriers; the runtime never reads their values.
export const integrationQueueMachine = setup({
  types: {
    context: {} as IntegrationQueueContext,
    events: {} as IntegrationQueueEvent,
    input: {} as IntegrationQueueInput,
  },
  actors: {
    integrate: fromPromise<LandResult, { readonly client: IntegrationQueueClient; readonly path: string }>(async ({ input, signal }) =>
      input.client.land({ path: input.path, signal }),
    ),
    watchProgress: fromCallback<IntegrationQueueEvent, { readonly client: IntegrationQueueClient; readonly path: string }>(({ input, sendBack }) => {
      const controller = new AbortController()
      let timer: ReturnType<typeof setTimeout> | undefined
      const poll = async (): Promise<void> => {
        try {
          const { progress } = await input.client.integrationProgress({ path: input.path, signal: controller.signal })
          if (progress !== null) sendBack({ type: 'progress', path: input.path, phase: progress.phase })
        } catch {
          // A poll that fails leaves the row on its last known phase; the landing call still owns the outcome.
        }
        if (!controller.signal.aborted) timer = setTimeout(() => void poll(), PROGRESS_POLL_MS)
      }
      void poll()
      return () => {
        controller.abort()
        if (timer !== undefined) clearTimeout(timer)
      }
    }),
  },
}).createMachine({
  id: 'threadIntegrationQueue',
  context: ({ input }) => ({ client: input.client, queue: [], activePath: null, jobs: new Map(), notice: null }),
  initial: 'idle',
  on: {
    progress: {
      guard: ({ context, event }) => context.activePath === event.path,
      actions: assign(({ context, event }) => ({ jobs: setJob(context.jobs, event.path, { phase: event.phase }) })),
    },
  },
  states: {
    idle: {
      on: {
        start: {
          guard: ({ event }) => event.paths.length > 0,
          target: 'queued',
          actions: assign(({ context, event }) => ({
            queue: [...new Set(event.paths)],
            activePath: null,
            jobs: queuedJobs(context.jobs, event.paths),
            notice: null,
          })),
        },
      },
    },
    queued: {
      tags: ['busy'],
      entry: assign(({ context }) => ({ activePath: context.queue[0] ?? null })),
      always: 'integrating',
    },
    integrating: {
      tags: ['busy'],
      entry: assign(({ context }) => {
        const path = context.activePath
        return path === null ? {} : { jobs: setJob(context.jobs, path, { phase: 'integrating' }) }
      }),
      invoke: [
        {
          src: 'integrate',
          input: ({ context }) => ({ client: context.client, path: context.activePath ?? '' }),
          onDone: [
            {
              guard: ({ context }) => context.queue.length > 1,
              target: 'queued',
              actions: assign(({ context, event }) => advanceQueue(context, jobForResult(event.output), noticeForResult(event.output))),
            },
            {
              target: 'idle',
              actions: assign(({ context, event }) => advanceQueue(context, jobForResult(event.output), noticeForResult(event.output))),
            },
          ],
          onError: [
            {
              guard: ({ context }) => context.queue.length > 1,
              target: 'queued',
              actions: assign(({ context, event }) =>
                advanceQueue(
                  context,
                  { phase: 'failed', message: event.error instanceof Error ? event.error.message : undefined },
                  noticeForFailure(event.error),
                ),
              ),
            },
            {
              target: 'idle',
              actions: assign(({ context, event }) =>
                advanceQueue(
                  context,
                  { phase: 'failed', message: event.error instanceof Error ? event.error.message : undefined },
                  noticeForFailure(event.error),
                ),
              ),
            },
          ],
        },
        {
          src: 'watchProgress',
          input: ({ context }) => ({ client: context.client, path: context.activePath ?? '' }),
        },
      ],
    },
  },
})
