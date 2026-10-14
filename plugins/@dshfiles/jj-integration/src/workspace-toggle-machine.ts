import { assign, emit, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import type { DestinationView } from './api.js'

export interface ProvisionedDestination {
  readonly workspaceId: string
  readonly destination?: DestinationView
}

export interface ProvisionInput {
  readonly workspaceId: string
  readonly isolate: boolean
  readonly base: string | undefined
  readonly name: string | undefined
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
  /** A thread workspace this project left unused for this bookmark, still listed and holding only blank Sessions. */
  readonly findSpare: (key: string) => SpareWorkspace | undefined
  readonly keepSpare: (key: string, spare: SpareWorkspace) => void
  /** Blocks the current composer until the returned release runs, so nothing is sent to the old destination. */
  readonly blockComposer: (reason: string) => () => void
  readonly generateName: () => string
  readonly preparingReason: (name: string | null) => string
}

export interface ToggleRequest {
  readonly isolate: boolean
  readonly base?: string | undefined
  readonly projectWorkspaceId: string
  /** The isolated thread workspace the blank thread sits in now, kept as a spare instead of being thrown away. */
  readonly leaving: SpareWorkspace | null
  readonly leavingBase: string | null
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
  /** The workspace a switch just opened: its fresh blank Session is where the thread belongs, so it stays. */
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
   * Session, so the same Session can be a new thread again later. With isolation on by default, Send waits until `resolved`.
   */
  | { readonly type: 'arrive'; readonly visitId: string; readonly workspaceId: string; readonly isolateByDefault: boolean }
  /** Its destination is known: `request` moves it to where new threads start by default, null keeps it. */
  | { readonly type: 'resolved'; readonly visitId: string; readonly request: ToggleRequest | null }
  | { readonly type: 'dismiss' }

/**
 * Where a blank New-thread Session should start, given its current destination: its own thread workspace when
 * isolation is on by default (unless it already sits alone in one), the project checkout when it is off and the
 * Session landed in another thread's workspace. Null keeps it where it is.
 */
export const defaultDestinationMove = (input: {
  readonly destination: DestinationView
  readonly workspaceId: string
  /** The workspace already holds another thread's non-blank Session. */
  readonly occupied: boolean
}): ToggleRequest | null => {
  const { destination } = input
  if (destination.vcs !== 'jj') return null
  const projectWorkspaceId = destination.projectWorkspaceId ?? input.workspaceId
  const move = { projectWorkspaceId, leaving: null, leavingBase: null }
  if (destination.isolateByDefault && (!destination.isolated || input.occupied)) return { ...move, isolate: true, base: destination.bookmark ?? undefined }
  if (!destination.isolateByDefault && destination.isolated && input.occupied) return { ...move, isolate: false }
  return null
}

/**
 * The same decision before the Host answered, for isolation on by default: a blank thread outside a thread workspace
 * (`<repository>-threads/thread-<id>`), or in one that holds another thread's work, gets its own. The Host resolves
 * the repository from whichever workspace it is given, and answers a folder outside jj with that folder unchanged.
 */
export const eagerDestinationMove = (input: {
  readonly workspaceId: string
  readonly inThreadWorkspace: boolean
  readonly occupied: boolean
  readonly bookmark: string
}): ToggleRequest | null =>
  input.inThreadWorkspace && !input.occupied
    ? null
    : { isolate: true, base: input.bookmark, projectWorkspaceId: input.workspaceId, leaving: null, leavingBase: null }

const pendingFor = (client: WorkspaceToggleClient, request: ToggleRequest, name: string | null): PendingDestination => {
  const spare = request.isolate ? (client.findSpare(spareKey(request.projectWorkspaceId, request.base)) ?? null) : null
  return { isolate: request.isolate, spare, name: request.isolate ? (spare?.name ?? name ?? client.generateName()) : null }
}

export const spareKey = (projectWorkspaceId: string, base: string | undefined | null): string => `${projectWorkspaceId}\u0000${base ?? ''}`

const errorText = (error: unknown): string => (error instanceof Error && error.message.length > 0 ? error.message : String(error))

// A Host from before the client-chosen name rejects the unknown field; retry without it and show what it created.
const provisionTolerant = async (client: WorkspaceToggleClient, input: ProvisionInput, signal: AbortSignal): Promise<ProvisionedDestination> => {
  try {
    return await client.provision(input, signal)
  } catch (error) {
    if (input.name === undefined || signal.aborted || !/name|unrecognized|invalid/iu.test(errorText(error))) throw error
    return client.provision({ ...input, name: undefined }, signal)
  }
}

/**
 * The new-thread workspace toggle: it flips at once (pending name shown, composer blocked), the Host creates or reuses
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
    holdComposer: fromCallback<{ readonly type: 'noop' }, { readonly client: WorkspaceToggleClient; readonly name: string | null }>(({ input }) =>
      input.client.blockComposer(input.client.preparingReason(input.name)),
    ),
    switchDestination: fromPromise<
      ProvisionedDestination,
      { readonly client: WorkspaceToggleClient; readonly request: ToggleRequest; readonly pending: PendingDestination }
    >(async ({ input, signal }) => {
      const { client, request, pending } = input
      const release = client.blockComposer(client.preparingReason(pending.name))
      try {
        if (request.leaving !== null) client.keepSpare(spareKey(request.projectWorkspaceId, request.leavingBase), request.leaving)
        const target: ProvisionedDestination = !pending.isolate
          ? { workspaceId: request.projectWorkspaceId }
          : pending.spare !== null
            ? { workspaceId: pending.spare.workspaceId }
            : await provisionTolerant(
                client,
                { workspaceId: request.projectWorkspaceId, isolate: true, base: request.base, name: pending.name ?? undefined },
                signal,
              )
        await client.listed(target.workspaceId)
        signal.throwIfAborted()
        await client.open(target.workspaceId, signal)
        return target
      } finally {
        release()
      }
    }),
  },
}).createMachine({
  id: 'workspaceToggle',
  context: ({ input }) => ({ client: input.client, request: null, pending: null, error: null, settled: [], arriving: null, opened: null }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        toggle: {
          target: 'switching',
          actions: assign(({ context, event }) => ({
            request: event.request,
            error: null,
            pending: pendingFor(context.client, event.request, null),
            settled: event.visitId === undefined ? context.settled : [...context.settled, event.visitId],
          })),
        },
        arrive: [
          {
            guard: ({ context, event }) => context.settled.includes(event.visitId),
          },
          {
            guard: ({ context, event }) => context.opened === event.workspaceId,
            actions: assign(({ context, event }) => ({ settled: [...context.settled, event.visitId], opened: null })),
          },
          {
            guard: ({ event }) => event.isolateByDefault,
            target: 'preparing',
            actions: assign(({ context, event }) => ({
              arriving: event.visitId,
              error: null,
              pending: { isolate: true, spare: null, name: context.client.generateName() },
            })),
          },
          { actions: assign({ arriving: ({ event }) => event.visitId }) },
        ],
        resolved: [
          {
            guard: ({ context, event }) => context.settled.includes(event.visitId) || event.visitId !== context.arriving,
          },
          {
            guard: ({ event }) => event.request === null,
            actions: assign(({ context, event }) => ({ settled: [...context.settled, event.visitId], arriving: null })),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              // SAFETY of the fallback: the previous branch took every null request.
              const request = event.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null }
              return { request, error: null, arriving: null, settled: [...context.settled, event.visitId], pending: pendingFor(context.client, request, null) }
            }),
          },
        ],
        dismiss: { actions: assign({ error: null }) },
      },
    },
    preparing: {
      // The Host has not said yet whether this thread moves; Send waits rather than reach the wrong checkout.
      invoke: { src: 'holdComposer', input: ({ context }) => ({ client: context.client, name: context.pending?.name ?? null }) },
      after: {
        15_000: {
          target: 'idle',
          actions: assign(({ context }) => ({
            pending: null,
            arriving: null,
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
            pending: pendingFor(context.client, event.request, null),
            settled: [...context.settled, ...(context.arriving === null ? [] : [context.arriving])],
          })),
        },
        resolved: [
          { guard: ({ context, event }) => event.visitId !== context.arriving },
          {
            guard: ({ event }) => event.request === null,
            target: 'idle',
            actions: assign(({ context, event }) => ({ pending: null, arriving: null, settled: [...context.settled, event.visitId] })),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              // SAFETY of the fallback: the previous branch took every null request.
              const request = event.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null }
              return {
                request,
                arriving: null,
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
            assign(({ event }) => ({ request: null, pending: null, opened: event.output.workspaceId })),
          ],
        },
        onError: { target: 'idle', actions: assign(({ event }) => ({ request: null, pending: null, error: errorText(event.error) })) },
      },
    },
  },
})
