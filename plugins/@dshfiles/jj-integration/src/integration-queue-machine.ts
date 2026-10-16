import { assign, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { LandResult } from './api.js'

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

export interface IntegrationQueueClient {
  readonly land: (input: { readonly path: string; readonly signal: AbortSignal }) => Promise<LandResult>
}

interface IntegrationQueueContext {
  readonly client: IntegrationQueueClient
  readonly queue: readonly string[]
  readonly activePath: string | null
  readonly jobs: ReadonlyMap<string, IntegrationJob>
}

interface IntegrationQueueInput {
  readonly client: IntegrationQueueClient
}

type IntegrationQueueEvent =
  | { readonly type: 'start'; readonly paths: readonly string[] }
  | { readonly type: 'progress'; readonly path: string; readonly phase: ActiveIntegrationPhase }

const setJob = (jobs: ReadonlyMap<string, IntegrationJob>, path: string, job: IntegrationJob): ReadonlyMap<string, IntegrationJob> =>
  new Map(jobs).set(path, job)

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

const advanceQueue = (context: IntegrationQueueContext, job: IntegrationJob): Partial<IntegrationQueueContext> => {
  const activePath = context.queue[0]
  if (activePath === undefined) return { activePath: null, queue: [] }
  return { activePath: null, queue: context.queue.slice(1), jobs: setJob(context.jobs, activePath, job) }
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
  },
}).createMachine({
  id: 'threadIntegrationQueue',
  context: ({ input }) => ({ client: input.client, queue: [], activePath: null, jobs: new Map() }),
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
      invoke: {
        src: 'integrate',
        input: ({ context }) => ({ client: context.client, path: context.activePath ?? '' }),
        onDone: [
          {
            guard: ({ context }) => context.queue.length > 1,
            target: 'queued',
            actions: assign(({ context, event }) => advanceQueue(context, jobForResult(event.output))),
          },
          {
            target: 'idle',
            actions: assign(({ context, event }) => advanceQueue(context, jobForResult(event.output))),
          },
        ],
        onError: [
          {
            guard: ({ context }) => context.queue.length > 1,
            target: 'queued',
            actions: assign(({ context, event }) =>
              advanceQueue(context, { phase: 'failed', message: event.error instanceof Error ? event.error.message : undefined }),
            ),
          },
          {
            target: 'idle',
            actions: assign(({ context, event }) =>
              advanceQueue(context, { phase: 'failed', message: event.error instanceof Error ? event.error.message : undefined }),
            ),
          },
        ],
      },
    },
  },
})
