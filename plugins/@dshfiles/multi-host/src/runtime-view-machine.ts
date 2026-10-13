import { assign, emit, enqueueActions, fromPromise, sendParent, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'

interface ViewPort {
  readonly openView: (
    input: { readonly runtimeId: string },
    options: { readonly signal: AbortSignal },
  ) => Promise<{ readonly leaseId: string; readonly launchUrl: string }>
  readonly closeView: (input: { readonly leaseId: string }) => Promise<unknown>
}

interface ViewPopup {
  readonly closed: boolean
  readonly close: () => void
  readonly location: { readonly replace: (url: string) => void }
}

type ParentEvent =
  | { readonly type: 'view.opened'; readonly runtimeId: string }
  | { readonly type: 'view.failed'; readonly viewId: string; readonly message: string }
  | { readonly type: 'view.released'; readonly viewId: string; readonly failure: string | null }

const failureMessage = (reason: unknown): string => (reason instanceof Error ? reason.message : 'The multi-host request failed.')

/** One native runtime view: open its lease, watch the popup once a second, release the lease when the popup closes. */
const runtimeViewLease = setup({
  types: {
    context: {} as { readonly viewId: string; readonly runtimeId: string; readonly popup: ViewPopup; readonly port: ViewPort; readonly leaseId: string | null },
    input: {} as { readonly viewId: string; readonly runtimeId: string; readonly popup: ViewPopup; readonly port: ViewPort },
    events: {} as { readonly type: 'release' },
  },
  actors: {
    open: fromPromise<{ readonly leaseId: string; readonly launchUrl: string }, { readonly port: ViewPort; readonly runtimeId: string }>(({ input, signal }) =>
      input.port.openView({ runtimeId: input.runtimeId }, { signal }),
    ),
    close: fromPromise<unknown, { readonly port: ViewPort; readonly leaseId: string }>(({ input }) => input.port.closeView({ leaseId: input.leaseId })),
  },
  delays: { poll: 1_000 },
  actions: {
    closePopup: ({ context }) => context.popup.close(),
  },
}).createMachine({
  id: 'runtimeViewLease',
  context: ({ input }) => ({ ...input, leaseId: null }),
  initial: 'opening',
  states: {
    opening: {
      invoke: {
        src: 'open',
        input: ({ context }) => ({ port: context.port, runtimeId: context.runtimeId }),
        onDone: {
          target: 'watching',
          actions: [
            assign(({ event }) => ({ leaseId: event.output.leaseId })),
            ({ context, event }) => context.popup.location.replace(event.output.launchUrl),
            sendParent(({ context }): ParentEvent => ({ type: 'view.opened', runtimeId: context.runtimeId })),
          ],
        },
        onError: {
          target: 'done',
          actions: [
            'closePopup',
            sendParent(({ context, event }): ParentEvent => ({ type: 'view.failed', viewId: context.viewId, message: failureMessage(event.error) })),
          ],
        },
      },
      on: {
        release: {
          target: 'done',
          actions: ['closePopup', sendParent(({ context }): ParentEvent => ({ type: 'view.released', viewId: context.viewId, failure: null }))],
        },
      },
    },
    watching: {
      after: {
        poll: [
          { guard: ({ context }) => context.popup.closed, target: 'releasing' },
          { target: 'watching', reenter: true },
        ],
      },
      on: { release: { target: 'releasing', actions: 'closePopup' } },
    },
    releasing: {
      invoke: {
        src: 'close',
        input: ({ context }) => ({ port: context.port, leaseId: context.leaseId ?? '' }),
        onDone: { target: 'done', actions: sendParent(({ context }): ParentEvent => ({ type: 'view.released', viewId: context.viewId, failure: null })) },
        onError: {
          target: 'done',
          actions: sendParent(({ context, event }): ParentEvent => ({ type: 'view.released', viewId: context.viewId, failure: failureMessage(event.error) })),
        },
      },
    },
    done: { type: 'final' },
  },
})

type ViewEntry = { readonly runtimeId: string; readonly ref: ActorRefFrom<typeof runtimeViewLease> }

/**
 * Every open native runtime view as a spawned lease actor. Stopping this machine stops each poll; the caller still
 * releases the leases it holds on unmount (`leaseIds`).
 */
export const runtimeViewsMachine = setup({
  types: {
    context: {} as {
      readonly port: ViewPort
      readonly views: Readonly<Record<string, ViewEntry>>
      readonly nextViewId: number
      readonly closingAll: { readonly failure: string | null } | null
      readonly error: string | null
    },
    input: {} as { readonly port: ViewPort },
    events: {} as
      | { readonly type: 'view.open'; readonly runtimeId: string; readonly popup: ViewPopup | null }
      | { readonly type: 'views.closeAll' }
      | { readonly type: 'error.clear' }
      | ParentEvent,
    emitted: {} as { readonly type: 'notice'; readonly message: string },
  },
  actors: { lease: runtimeViewLease },
}).createMachine({
  id: 'runtimeViews',
  context: ({ input }) => ({ port: input.port, views: {}, nextViewId: 0, closingAll: null, error: null }),
  on: {
    'view.open': [
      { guard: ({ event }) => event.popup === null, actions: assign({ error: 'Allow pop-ups to open the native runtime view.' }) },
      {
        actions: assign(({ context, event, spawn }) => {
          if (event.popup === null) return {}
          const viewId = `view-${context.nextViewId}`
          const ref = spawn('lease', { id: viewId, input: { viewId, runtimeId: event.runtimeId, popup: event.popup, port: context.port } })
          return { views: { ...context.views, [viewId]: { runtimeId: event.runtimeId, ref } }, nextViewId: context.nextViewId + 1, error: null }
        }),
      },
    ],
    'view.opened': {
      actions: emit(
        ({ event }) =>
          ({ type: 'notice', message: `Opened an isolated browser origin for ${event.runtimeId}. Close its tab to release the connection.` }) as const,
      ),
    },
    'view.failed': {
      actions: assign(({ context, event }) => ({
        views: Object.fromEntries(Object.entries(context.views).filter(([viewId]) => viewId !== event.viewId)),
        error: event.message,
      })),
    },
    'view.released': {
      actions: enqueueActions(({ context, event, enqueue }) => {
        const views = Object.fromEntries(Object.entries(context.views).filter(([viewId]) => viewId !== event.viewId))
        if (context.closingAll === null) {
          enqueue.assign({
            views,
            ...(event.failure === null ? {} : { error: 'Runtime view closed. Its tunnel will expire automatically if the host is unreachable.' }),
          })
          return
        }
        const failure = context.closingAll.failure ?? event.failure
        if (Object.keys(views).length > 0) {
          enqueue.assign({ views, closingAll: { failure } })
          return
        }
        enqueue.assign({ views, closingAll: null, ...(failure === null ? {} : { error: failure }) })
        if (failure === null) enqueue.emit({ type: 'notice', message: 'Closed all native runtime views and released their tunnels.' })
      }),
    },
    'views.closeAll': {
      guard: ({ context }) => Object.keys(context.views).length > 0,
      actions: enqueueActions(({ context, enqueue }) => {
        enqueue.assign({ closingAll: { failure: null } })
        for (const view of Object.values(context.views)) enqueue.sendTo(view.ref, { type: 'release' })
      }),
    },
    'error.clear': { actions: assign({ error: null }) },
  },
})

/** Close every open popup and release its lease, best effort, when the panel goes away mid-flight. */
export const releaseHeldViews = (views: Readonly<Record<string, ViewEntry>>, port: ViewPort): void => {
  for (const view of Object.values(views)) {
    const context = view.ref.getSnapshot().context
    context.popup.close()
    if (context.leaseId !== null) void port.closeView({ leaseId: context.leaseId }).catch(() => undefined)
  }
}
