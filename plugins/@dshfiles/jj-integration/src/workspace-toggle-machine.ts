import { assign, emit, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
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
  readonly open: (workspaceId: string) => Promise<void>
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
}

interface ToggleInput {
  readonly client: WorkspaceToggleClient
}

interface ToggleSwitched {
  readonly type: 'switched'
  readonly workspaceId: string
  readonly destination: DestinationView | undefined
}

type ToggleEvent = { readonly type: 'toggle'; readonly request: ToggleRequest } | { readonly type: 'dismiss' }

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
        await client.open(target.workspaceId)
        return target
      } finally {
        release()
      }
    }),
  },
}).createMachine({
  id: 'workspaceToggle',
  context: ({ input }) => ({ client: input.client, request: null, pending: null, error: null }),
  initial: 'idle',
  states: {
    idle: {
      on: {
        toggle: {
          target: 'switching',
          actions: assign(({ context, event }) => {
            const spare = event.request.isolate ? (context.client.findSpare(spareKey(event.request.projectWorkspaceId, event.request.base)) ?? null) : null
            return {
              request: event.request,
              error: null,
              pending: {
                isolate: event.request.isolate,
                spare,
                name: event.request.isolate ? (spare?.name ?? context.client.generateName()) : null,
              },
            }
          }),
        },
        dismiss: { actions: assign({ error: null }) },
      },
    },
    switching: {
      invoke: {
        src: 'switchDestination',
        input: ({ context }) => ({
          client: context.client,
          // SAFETY of the fallbacks: `switching` is only entered from `toggle`, which sets both.
          request: context.request ?? { isolate: false, projectWorkspaceId: '', leaving: null, leavingBase: null },
          pending: context.pending ?? { isolate: false, name: null, spare: null },
        }),
        onDone: {
          target: 'idle',
          actions: [
            emit(({ event }) => ({ type: 'switched' as const, workspaceId: event.output.workspaceId, destination: event.output.destination })),
            assign({ request: null, pending: null }),
          ],
        },
        onError: { target: 'idle', actions: assign(({ event }) => ({ request: null, pending: null, error: errorText(event.error) })) },
      },
    },
  },
})
