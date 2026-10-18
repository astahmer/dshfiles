import { assign, emit, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import type { DestinationView } from './api.js'

export interface ProvisionedDestination {
  readonly workspaceId: string
  readonly destination?: DestinationView | undefined
}

export interface ProvisionInput {
  readonly workspaceId: string
  readonly isolate: boolean
  readonly base?: string
  readonly name?: string
}

export interface SpareWorkspace {
  readonly workspaceId: string
  readonly name: string
}

export interface WorkspaceToggleClient {
  readonly provision: (input: ProvisionInput, signal: AbortSignal) => Promise<ProvisionedDestination>
  /** Resolves once the Workspace list carries the id; the client refuses to open an id it has not seen. */
  readonly listed: (workspaceId: string) => Promise<void>
  readonly open: (workspaceId: string, signal: AbortSignal) => Promise<void>
  /** A thread workspace this project left unused for this bookmark, with no other Session assigned to it. */
  readonly findSpare: (key: string) => SpareWorkspace | undefined
  readonly keepSpare: (key: string, spare: SpareWorkspace) => void
  readonly consumeSpare: (key: string, spare: SpareWorkspace) => void
  readonly generateName: () => string
  readonly preparationTimeoutReason: () => string
}

export interface ToggleRequest {
  readonly isolate: boolean
  readonly base?: string
  readonly projectWorkspaceId: string
  /** The isolated thread workspace the blank thread sits in now, kept as a spare instead of being thrown away. */
  readonly leaving: SpareWorkspace | null
  readonly leavingBase: string | null
  readonly excludeSpareWorkspaceId?: string
}

export interface PendingDestination {
  readonly isolate: boolean
  readonly name: string | null
  readonly spare: SpareWorkspace | null
}

interface ToggleContext {
  readonly client: WorkspaceToggleClient
  readonly request: ToggleRequest | null
  readonly pending: PendingDestination | null
  readonly error: string | null
  /** New-thread visits whose destination was already settled, by the default or by the user; never moved again. */
  readonly settled: readonly string[]
  /** The New-thread visit waiting for its destination to decide whether it moves. */
  readonly arriving: string | null
  /** The workspace a switch just opened; the next blank Session to arrive there continues that switch's visit. */
  readonly opened: string | null
}

interface ToggleInput {
  readonly client: WorkspaceToggleClient
}

interface ToggleSwitched {
  readonly type: 'switched'
  readonly workspaceId: string
  readonly destination: DestinationView | undefined
}

type ToggleEvent =
  | { readonly type: 'toggle'; readonly request: ToggleRequest; readonly visitId?: string | undefined }
  /**
   * A blank New-thread Session showed in `workspaceId`. `visitId` names this showing: DSH reuses a workspace's blank
   * Session, so the same Session can be a new thread again later. A switch has DSH open a fresh blank Session in the
   * workspace it moved to, so the arrival that follows a switch carries a new visit id for the same thread. With
   * isolation on by default, a submitted Send waits until the destination Session is open.
   */
  | { readonly type: 'arrive'; readonly visitId: string; readonly workspaceId: string; readonly isolateByDefault: boolean }
  /** Its destination is known: `request` moves it to where new threads start by default, null keeps it. */
  | { readonly type: 'resolved'; readonly visitId: string; readonly request: ToggleRequest | null }
  | { readonly type: 'dismiss' }

/**
 * Where a blank New-thread Session should start: in its own workspace when isolation is the default, or in the
 * project checkout when it inherited another thread's workspace and isolation is off.
 */
const defaultDestinationMove = (input: { readonly destination: DestinationView; readonly workspaceId: string }): ToggleRequest | null => {
  const { destination } = input
  if (destination.vcs !== 'jj') return null
  const projectWorkspaceId = destination.projectWorkspaceId ?? input.workspaceId
  const move = { projectWorkspaceId, leaving: null, leavingBase: null }
  if (destination.isolateByDefault) {
    let isolateMove: ToggleRequest = { ...move, isolate: true }
    if (input.workspaceId !== projectWorkspaceId) isolateMove = { ...isolateMove, excludeSpareWorkspaceId: input.workspaceId }
    if (destination.bookmark === null) return isolateMove
    return { ...isolateMove, base: destination.bookmark }
  }
  if (destination.isolated) return { ...move, isolate: false }
  return null
}

/**
 * Starts isolation before the Host answers. When the composer inherited a thread workspace, exclude that workspace
 * from spare reuse so this New thread cannot keep using the previous thread's folder.
 */
const eagerDestinationMove = (input: { readonly workspaceId: string; readonly projectWorkspaceId: string; readonly bookmark: string }): ToggleRequest => {
  const request: ToggleRequest = {
    isolate: true,
    base: input.bookmark,
    projectWorkspaceId: input.projectWorkspaceId,
    leaving: null,
    leavingBase: null,
  }
  if (input.workspaceId === input.projectWorkspaceId) return request
  return { ...request, excludeSpareWorkspaceId: input.workspaceId }
}

const pendingFor = (client: WorkspaceToggleClient, request: ToggleRequest, name: string | null): PendingDestination => {
  const candidate = request.isolate ? client.findSpare(spareKey(request.projectWorkspaceId, request.base)) : undefined
  const spare = candidate?.workspaceId === request.excludeSpareWorkspaceId ? null : (candidate ?? null)
  return { isolate: request.isolate, spare, name: request.isolate ? (spare?.name ?? name ?? client.generateName()) : null }
}

const spareKey = (projectWorkspaceId: string, base: string | undefined | null): string => `${projectWorkspaceId}\u0000${base ?? ''}`

const errorText = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : String(error))

const provisionInputFor = (input: { readonly workspaceId: string; readonly base: string | undefined; readonly name: string | null }): ProvisionInput => {
  let provisionInput: ProvisionInput = { workspaceId: input.workspaceId, isolate: true }
  if (input.base !== undefined) provisionInput = { ...provisionInput, base: input.base }
  if (input.name !== null) provisionInput = { ...provisionInput, name: input.name }
  return provisionInput
}

// A Host from before the client-chosen name rejects the unknown field; retry without it and show what it created.
const provisionTolerant = async (client: WorkspaceToggleClient, input: ProvisionInput, signal: AbortSignal): Promise<ProvisionedDestination> => {
  try {
    return await client.provision(input, signal)
  } catch (error) {
    const { name, ...inputWithoutName } = input
    if (name === undefined || signal.aborted || !/name|unrecognized|invalid/iu.test(errorText(error))) throw error
    return client.provision(inputWithoutName, signal)
  }
}

/**
 * The new-thread workspace toggle: it flips at once (pending name shown while the composer stays usable), the Host creates or reuses
 * the thread workspace in the background, and `switched` hands the caller the Host's new destination so nothing is
 * re-queried. Leaving a thread workspace keeps it as this project's spare, so toggling back reuses it and its blank
 * Session instead of creating another.
 *
 * A New thread also arrives here: every entry point (sidebar, palette, project picker) opens the native composer at
 * once in the project or current checkout, and `arrive` / `resolved` move that blank Session to where new threads
 * start by default in the background, the same way as the toggle. Each Session is settled once, so a later manual
 * toggle is never undone.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
export const workspaceToggleMachine = setup({
  types: {
    context: {} as ToggleContext,
    events: {} as ToggleEvent,
    input: {} as ToggleInput,
    emitted: {} as ToggleSwitched,
  },
  actors: {
    switchDestination: fromPromise<
      ProvisionedDestination,
      { readonly client: WorkspaceToggleClient; readonly request: ToggleRequest; readonly pending: PendingDestination }
    >(async ({ input, signal }) => {
      const { client, request, pending } = input
      if (request.leaving !== null) client.keepSpare(spareKey(request.projectWorkspaceId, request.leavingBase), request.leaving)
      const target: ProvisionedDestination = !pending.isolate
        ? { workspaceId: request.projectWorkspaceId }
        : pending.spare !== null
          ? { workspaceId: pending.spare.workspaceId }
          : await provisionTolerant(client, provisionInputFor({ workspaceId: request.projectWorkspaceId, base: request.base, name: pending.name }), signal)
      await client.listed(target.workspaceId)
      signal.throwIfAborted()
      await client.open(target.workspaceId, signal)
      if (pending.spare !== null) client.consumeSpare(spareKey(request.projectWorkspaceId, request.base), pending.spare)
      return target
    }),
  },
}).createMachine({
  id: 'workspaceToggle',
  context: ({ input }) => ({
    client: input.client,
    request: null,
    pending: null,
    error: null,
    settled: [],
    arriving: null,
    opened: null,
  }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        toggle: {
          target: 'switching',
          actions: assign(({ context, event }) => ({
            request: event.request,
            error: null,
            arriving: null,
            opened: null,
            pending: pendingFor(context.client, event.request, null),
            settled: event.visitId === undefined ? context.settled : [...context.settled, event.visitId],
          })),
        },
        arrive: [
          {
            guard: ({ context, event }) => context.settled.includes(event.visitId),
          },
          {
            // A switch has DSH open a fresh blank Session in the workspace it moved the visit to, so that arrival
            // carries a new visit id. It continues the switch rather than starting a new thread: settle it, and let
            // the next blank Session to arrive there be a new visit that follows the default destination again.
            guard: ({ context, event }) => context.opened === event.workspaceId,
            actions: assign(({ context, event }) => ({ settled: [...context.settled, event.visitId], opened: null, error: null })),
          },
          {
            guard: ({ event }) => event.isolateByDefault,
            target: 'preparing',
            actions: assign(({ context, event }) => ({
              arriving: event.visitId,
              error: null,
              opened: null,
              pending: { isolate: true, spare: null, name: context.client.generateName() },
            })),
          },
          { actions: assign({ arriving: ({ event }) => event.visitId, opened: null, error: null }) },
        ],
        resolved: [
          {
            guard: ({ context, event }) => context.settled.includes(event.visitId) || event.visitId !== context.arriving,
          },
          {
            guard: ({ event }) => event.request === null,
            actions: assign(({ context, event }) => ({
              settled: [...context.settled, event.visitId],
              arriving: null,
              opened: null,
            })),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              // SAFETY of the fallback: the previous branch took every null request.
              const request = event.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null }
              return {
                request,
                error: null,
                arriving: null,
                opened: null,
                settled: [...context.settled, event.visitId],
                pending: pendingFor(context.client, request, null),
              }
            }),
          },
        ],
        dismiss: { actions: assign({ error: null }) },
      },
    },
    preparing: {
      after: {
        15_000: {
          target: 'idle',
          actions: assign(({ context }) => ({
            pending: null,
            arriving: null,
            opened: null,
            error: context.client.preparationTimeoutReason(),
            settled: [...context.settled, ...(context.arriving === null ? [] : [context.arriving])],
          })),
        },
      },
      on: {
        toggle: {
          target: 'switching',
          actions: assign(({ context, event }) => ({
            request: event.request,
            error: null,
            arriving: null,
            opened: null,
            pending: pendingFor(context.client, event.request, null),
            settled: [...context.settled, ...(context.arriving === null ? [] : [context.arriving])],
          })),
        },
        resolved: [
          { guard: ({ context, event }) => event.visitId !== context.arriving },
          {
            guard: ({ event }) => event.request === null,
            target: 'idle',
            actions: assign(({ context, event }) => ({
              pending: null,
              arriving: null,
              opened: null,
              settled: [...context.settled, event.visitId],
            })),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              // SAFETY of the fallback: the previous branch took every null request.
              const request = event.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null }
              return {
                request,
                arriving: null,
                opened: null,
                settled: [...context.settled, event.visitId],
                pending: pendingFor(context.client, request, context.pending?.name ?? null),
              }
            }),
          },
        ],
      },
    },
    switching: {
      invoke: {
        src: 'switchDestination',
        input: ({ context }) => ({
          client: context.client,
          // SAFETY of the fallbacks: `switching` is only entered from `toggle` or `resolved`, which set both.
          request: context.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null },
          pending: context.pending ?? { isolate: false, name: null, spare: null },
        }),
        onDone: {
          target: 'idle',
          actions: [
            emit(({ event }) => ({ type: 'switched' as const, workspaceId: event.output.workspaceId, destination: event.output.destination })),
            assign(({ event }) => ({
              request: null,
              pending: null,
              opened: event.output.workspaceId,
            })),
          ],
        },
        onError: {
          target: 'idle',
          actions: assign(({ event }) => ({
            request: null,
            pending: null,
            opened: null,
            error: errorText(event.error),
          })),
        },
      },
    },
  },
})

export type WorkspaceToggleActor = ActorRefFrom<typeof workspaceToggleMachine>

export interface WorkspaceToggleOutcome {
  readonly workspaceId: string | null
  readonly error: string | null
}

const waitForWorkspaceToggle = (input: { readonly actor: WorkspaceToggleActor; readonly signal: AbortSignal }): Promise<WorkspaceToggleOutcome> =>
  new Promise((resolve, reject) => {
    let settled = false
    let unsubscribe = (): void => undefined
    const abort = (): void => {
      if (settled) return
      settled = true
      unsubscribe()
      input.signal.removeEventListener('abort', abort)
      reject(input.signal.reason ?? new Error('Waiting for workspace destination was cancelled.'))
    }
    const finish = (snapshot: ReturnType<WorkspaceToggleActor['getSnapshot']>): void => {
      if (settled || !snapshot.matches('idle')) return
      settled = true
      unsubscribe()
      input.signal.removeEventListener('abort', abort)
      resolve({ workspaceId: snapshot.context.opened, error: snapshot.context.error })
    }
    input.signal.addEventListener('abort', abort, { once: true })
    if (input.signal.aborted) {
      abort()
      return
    }
    const subscription = input.actor.subscribe(finish)
    unsubscribe = () => subscription.unsubscribe()
    if (settled) {
      unsubscribe()
      return
    }
    finish(input.actor.getSnapshot())
  })

export class WorkspaceToggle {
  static readonly defaultDestinationMove = defaultDestinationMove
  static readonly eagerDestinationMove = eagerDestinationMove
  static readonly spareKey = spareKey
  static readonly waitForWorkspaceToggle = waitForWorkspaceToggle
}
