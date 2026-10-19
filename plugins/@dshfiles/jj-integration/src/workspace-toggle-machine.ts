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

/**
 * A blank New thread whose isolation starts on its first send: arriving creates no jj workspace and opens none, and
 * abandoning it leaves nothing behind. The move is keyed by Session, so two New threads waiting at once never share
 * one destination.
 */
export interface DeferredMove {
  readonly sessionId: string
  readonly visitId: string
  /** The workspace the blank Session arrived in; a different one means the thread was moved before it sent. */
  readonly workspaceId: string
  readonly name: string
  /** What the destination bar shows while the move waits, so a default-isolated New thread looks isolated. */
  readonly wantsIsolation: boolean
  /** Where the thread moves on its first send; null until the Host's destination names where new threads start. */
  readonly request: ToggleRequest | null
}

interface SwitchArrival {
  readonly visitId: string
  readonly workspaceId: string
}

interface ToggleContext {
  readonly client: WorkspaceToggleClient
  readonly request: ToggleRequest | null
  readonly pending: PendingDestination | null
  readonly error: string | null
  /** New-thread visits whose destination was already settled, by the default or by the user; never moved again. */
  readonly settled: readonly string[]
  /** Blank New threads waiting for their first send, one entry per Session. */
  readonly deferred: readonly DeferredMove[]
  /** The workspace the last blank Session arrived in; a switch that opens it again moved nothing. */
  readonly currentWorkspaceId: string | null
  /** Blank Sessions that arrived while a switch ran; the one in the workspace it opened continues that visit. */
  readonly switchArrivals: readonly SwitchArrival[]
  /** The visit whose destination a committed first send waits for. */
  readonly committing: string | null
  /** The workspace the last switch opened or landed in; what a held send waits to deliver into. */
  readonly landed: string | null
  /** The workspace a switch opened whose continuing blank Session has not arrived yet; that arrival settles here. */
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
   * isolation on by default, its isolation waits for the first send instead of creating a workspace here.
   */
  | {
      readonly type: 'arrive'
      readonly visitId: string
      readonly sessionId: string
      readonly workspaceId: string
      readonly isolateByDefault: boolean
    }
  /** Its destination is known: `request` moves it to where new threads start by default, null keeps it. */
  | { readonly type: 'resolved'; readonly visitId: string; readonly request: ToggleRequest | null }
  /** The first send of that Session: start the move its arrival deferred. */
  | { readonly type: 'commit'; readonly sessionId: string }
  /** That Session was archived, discarded or stopped being blank, so its deferred move is dropped. */
  | { readonly type: 'cancel'; readonly sessionId: string }
  | { readonly type: 'dismiss' }

/**
 * A thread workspace no other Session shares is already the destination of the blank thread sitting in it. The
 * client forgets what it switched on a page reload, and a switch itself makes DSH open a fresh Session in the
 * workspace it moved to; without this, each of those arrivals reads as a new thread and provisions another
 * workspace, so one New thread could leave a trail of them. A Host predating the ownership field answers nothing,
 * which keeps the old behaviour of moving the thread out.
 */
export const ownsIsolatedThreadWorkspace = (destination: DestinationView): boolean => destination.isolated && destination.ownedByAnotherSession === false

/**
 * Whether the first send of that Session starts the isolation its arrival deferred: isolation on by default does, a
 * New thread that starts in the project checkout and stays there does not, so its send goes straight through.
 */
export const defersIsolationToSend = (move: DeferredMove | null | undefined): boolean =>
  move !== null && move !== undefined && (move.request?.isolate ?? move.wantsIsolation)

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
    if (ownsIsolatedThreadWorkspace(destination)) return null
    let isolateMove: ToggleRequest = { ...move, isolate: true }
    if (input.workspaceId !== projectWorkspaceId) isolateMove = { ...isolateMove, excludeSpareWorkspaceId: input.workspaceId }
    if (destination.bookmark === null) return isolateMove
    return { ...isolateMove, base: destination.bookmark }
  }
  if (destination.isolated) return { ...move, isolate: false }
  return null
}

const pendingFor = (client: WorkspaceToggleClient, request: ToggleRequest, name: string | null): PendingDestination => {
  const candidate = request.isolate ? client.findSpare(spareKey(request.projectWorkspaceId, request.base)) : undefined
  const spare = candidate?.workspaceId === request.excludeSpareWorkspaceId ? null : (candidate ?? null)
  return { isolate: request.isolate, spare, name: request.isolate ? (spare?.name ?? name ?? client.generateName()) : null }
}

const deferredMoveFor = (deferred: readonly DeferredMove[], sessionId: string): DeferredMove | null =>
  deferred.find(move => move.sessionId === sessionId) ?? null

const deferredVisitFor = (deferred: readonly DeferredMove[], visitId: string): DeferredMove | null => deferred.find(move => move.visitId === visitId) ?? null

const withDeferred = (deferred: readonly DeferredMove[], move: DeferredMove): readonly DeferredMove[] => [
  ...deferred.filter(candidate => candidate.sessionId !== move.sessionId),
  move,
]

const withoutDeferredSession = (deferred: readonly DeferredMove[], sessionId: string): readonly DeferredMove[] =>
  deferred.filter(move => move.sessionId !== sessionId)

const withoutDeferredVisit = (deferred: readonly DeferredMove[], visitId: string): readonly DeferredMove[] => deferred.filter(move => move.visitId !== visitId)

/** The ids `settled` gained, without duplicates; a visit settles at most once but may be named by two events. */
const settledWith = (settled: readonly string[], ...visits: readonly (string | null | undefined)[]): readonly string[] => {
  const next = [...settled]
  for (const visit of visits) {
    if (visit !== null && visit !== undefined && !next.includes(visit)) next.push(visit)
  }
  return next
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
 * once in the project or current checkout. With isolation on by default the arrival only records the move it would
 * make — `commit` on the first send starts it, and `deferWorkspaceSubmit` delivers that same draft into the Session
 * the switch opens — so an abandoned New thread creates no workspace and opens none. Isolation off still moves the
 * blank thread back to the project checkout on arrival, which creates nothing. Each Session is settled once, so a
 * later manual toggle is never undone.
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
    deferred: [],
    currentWorkspaceId: null,
    switchArrivals: [],
    committing: null,
    landed: null,
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
            committing: null,
            landed: null,
            opened: null,
            pending: pendingFor(context.client, event.request, null),
            settled: settledWith(context.settled, event.visitId),
            deferred: event.visitId === undefined ? context.deferred : withoutDeferredVisit(context.deferred, event.visitId),
            switchArrivals: [],
          })),
        },
        arrive: [
          {
            guard: ({ context, event }) => context.settled.includes(event.visitId),
            actions: assign({ currentWorkspaceId: ({ event }) => event.workspaceId }),
          },
          {
            // A switch has DSH open a fresh blank Session in the workspace it moved the visit to, so that arrival
            // carries a new visit id. It continues the switch rather than starting a new thread: settle it, and let
            // the next blank Session to arrive there be a new visit that follows the default destination again.
            guard: ({ context, event }) => context.opened === event.workspaceId,
            actions: assign(({ context, event }) => ({
              settled: settledWith(context.settled, event.visitId),
              currentWorkspaceId: event.workspaceId,
              opened: null,
              error: null,
            })),
          },
          {
            guard: ({ context, event }) => deferredMoveFor(context.deferred, event.sessionId)?.workspaceId === event.workspaceId,
            // The same New thread re-reports its arrival (a settings or destination change); keep the move it already
            // deferred, including a name the Host has since used, and only refresh what the destination bar shows.
            actions: assign(({ context, event }) => ({
              currentWorkspaceId: event.workspaceId,
              deferred: context.deferred.map(move => (move.sessionId === event.sessionId ? { ...move, wantsIsolation: event.isolateByDefault } : move)),
            })),
          },
          {
            // A New thread that has not sent yet (or the same Session moved to another project): isolation on by
            // default starts on the first send, so the composer stays in the project checkout and no jj workspace
            // exists while the thread is empty.
            actions: assign(({ context, event }) => ({
              currentWorkspaceId: event.workspaceId,
              error: null,
              opened: null,
              deferred: withDeferred(context.deferred, {
                sessionId: event.sessionId,
                visitId: event.visitId,
                workspaceId: event.workspaceId,
                name: context.client.generateName(),
                wantsIsolation: event.isolateByDefault,
                request: null,
              }),
            })),
          },
        ],
        resolved: [
          {
            guard: ({ context, event }) => deferredVisitFor(context.deferred, event.visitId) === null,
          },
          {
            guard: ({ event }) => event.request === null,
            actions: assign(({ context, event }) => ({
              settled: settledWith(context.settled, event.visitId),
              opened: null,
              deferred: withoutDeferredVisit(context.deferred, event.visitId),
            })),
          },
          {
            guard: ({ event }) => event.request?.isolate === true,
            // Isolation is the default: keep the move for the first send instead of creating a workspace now.
            actions: assign(({ context, event }) => ({
              error: null,
              deferred: context.deferred.map(move => (move.visitId === event.visitId ? { ...move, request: event.request } : move)),
            })),
          },
          {
            // Isolation off: a thread that inherited another thread's workspace moves back to the project checkout,
            // which creates nothing.
            target: 'switching',
            actions: assign(({ context, event }) => ({
              request: event.request,
              error: null,
              committing: null,
              landed: null,
              opened: null,
              settled: settledWith(context.settled, event.visitId),
              pending: event.request === null ? null : pendingFor(context.client, event.request, null),
              deferred: withoutDeferredVisit(context.deferred, event.visitId),
              switchArrivals: [],
            })),
          },
        ],
        commit: [
          {
            guard: ({ context, event }) => deferredMoveFor(context.deferred, event.sessionId) === null,
          },
          {
            guard: ({ context, event }) => deferredMoveFor(context.deferred, event.sessionId)?.request === null,
            target: 'preparing',
            actions: assign(({ context, event }) => {
              const move = deferredMoveFor(context.deferred, event.sessionId)
              return {
                request: null,
                error: null,
                opened: null,
                committing: move?.visitId ?? null,
                pending: move === null ? null : { isolate: true, name: move.name, spare: null },
              }
            }),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              const move = deferredMoveFor(context.deferred, event.sessionId)
              const request = move?.request ?? null
              return {
                request,
                error: null,
                committing: null,
                landed: null,
                opened: null,
                settled: settledWith(context.settled, move?.visitId),
                pending: move === null || request === null ? null : pendingFor(context.client, request, move.name),
                deferred: withoutDeferredSession(context.deferred, event.sessionId),
                switchArrivals: [],
              }
            }),
          },
        ],
        cancel: {
          actions: assign(({ context, event }) => ({ deferred: withoutDeferredSession(context.deferred, event.sessionId) })),
        },
        dismiss: { actions: assign({ error: null }) },
      },
    },
    preparing: {
      after: {
        15_000: {
          target: 'idle',
          actions: assign(({ context }) => ({
            pending: null,
            committing: null,
            opened: null,
            error: context.client.preparationTimeoutReason(),
            settled: settledWith(context.settled, context.committing),
            deferred: context.committing === null ? context.deferred : withoutDeferredVisit(context.deferred, context.committing),
          })),
        },
      },
      on: {
        toggle: {
          target: 'switching',
          actions: assign(({ context, event }) => ({
            request: event.request,
            error: null,
            committing: null,
            landed: null,
            opened: null,
            pending: pendingFor(context.client, event.request, null),
            settled: settledWith(context.settled, context.committing, event.visitId),
            deferred: event.visitId === undefined ? context.deferred : withoutDeferredVisit(context.deferred, event.visitId),
            switchArrivals: [],
          })),
        },
        resolved: [
          { guard: ({ context, event }) => event.visitId !== context.committing },
          {
            guard: ({ event }) => event.request === null,
            target: 'idle',
            actions: assign(({ context, event }) => ({
              pending: null,
              committing: null,
              opened: null,
              settled: settledWith(context.settled, event.visitId),
              deferred: withoutDeferredVisit(context.deferred, event.visitId),
            })),
          },
          {
            target: 'switching',
            actions: assign(({ context, event }) => {
              const move = deferredVisitFor(context.deferred, event.visitId)
              return {
                request: event.request,
                error: null,
                committing: null,
                landed: null,
                opened: null,
                settled: settledWith(context.settled, event.visitId),
                pending: event.request === null ? null : pendingFor(context.client, event.request, move?.name ?? null),
                deferred: withoutDeferredVisit(context.deferred, event.visitId),
                switchArrivals: [],
              }
            }),
          },
        ],
        cancel: [
          {
            // The Session whose first send started this wait went away: drop its move and stop waiting.
            guard: ({ context, event }) => context.committing !== null && deferredVisitFor(context.deferred, context.committing)?.sessionId === event.sessionId,
            target: 'idle',
            actions: assign(({ context, event }) => ({
              pending: null,
              committing: null,
              opened: null,
              error: null,
              deferred: withoutDeferredSession(context.deferred, event.sessionId),
            })),
          },
          {
            actions: assign(({ context, event }) => ({ deferred: withoutDeferredSession(context.deferred, event.sessionId) })),
          },
        ],
      },
    },
    switching: {
      on: {
        // DSH opens the blank Session this switch moved the thread to before `open` resolves, so that arrival lands
        // while the switch still runs. Remember it: the one in the workspace the switch opened continues this visit,
        // and settling it on completion keeps `opened` from swallowing the next New thread there.
        arrive: {
          actions: assign(({ context, event }) => ({
            currentWorkspaceId: event.workspaceId,
            switchArrivals: [...context.switchArrivals, { visitId: event.visitId, workspaceId: event.workspaceId }],
          })),
        },
      },
      invoke: {
        src: 'switchDestination',
        input: ({ context }) => ({
          client: context.client,
          // SAFETY of the fallbacks: `switching` is only entered from `toggle` or a `resolved` / `commit` branch that
          // carried a request and a pending destination.
          request: context.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null },
          pending: context.pending ?? { isolate: false, name: null, spare: null },
        }),
        onDone: {
          target: 'idle',
          actions: [
            emit(({ event }) => ({ type: 'switched' as const, workspaceId: event.output.workspaceId, destination: event.output.destination })),
            assign(({ context, event }) => {
              const continued = context.switchArrivals.filter(arrival => arrival.workspaceId === event.output.workspaceId)
              const continuesNow = continued.length > 0 || event.output.workspaceId === context.currentWorkspaceId
              return {
                request: null,
                pending: null,
                landed: event.output.workspaceId,
                // A continuing blank Session has already arrived (or the switch opened the workspace the thread is
                // already in, which moves nothing and opens no Session), so no later arrival there continues it;
                // treating one as a continuation would settle the next New thread's move away.
                opened: continuesNow ? null : event.output.workspaceId,
                settled: settledWith(context.settled, ...continued.map(arrival => arrival.visitId)),
                switchArrivals: [],
              }
            }),
          ],
        },
        onError: {
          target: 'idle',
          actions: assign(({ event }) => ({
            request: null,
            pending: null,
            opened: null,
            error: errorText(event.error),
            switchArrivals: [],
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
      resolve({ workspaceId: snapshot.context.landed, error: snapshot.context.error })
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
  static readonly deferredMoveFor = (snapshot: { readonly context: { readonly deferred: readonly DeferredMove[] } }, sessionId: string): DeferredMove | null =>
    deferredMoveFor(snapshot.context.deferred, sessionId)
  static readonly spareKey = spareKey
  static readonly waitForWorkspaceToggle = waitForWorkspaceToggle
}
