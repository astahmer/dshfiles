import { assign, createActor, fromCallback, fromPromise, setup, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'

export interface ComposerView {
  readonly draft: string
  readonly attachmentIds: readonly string[]
}

export type UploadStatus = 'uploading' | 'ready' | 'failed'

export interface PendingSendPorts {
  readonly composer: { getSnapshot(): ComposerView; subscribe(listener: () => void): () => void }
  /** The combined status of the file uploads among `ids`; images never upload, so they count as ready. */
  readonly uploads: { status(ids: readonly string[]): UploadStatus; subscribe(listener: () => void): () => void }
  readonly submit: () => Promise<void>
}

/** One upload wait never outlives a stuck network. */
const UPLOAD_TIMEOUT_MS = 5 * 60_000

const sameComposer = (left: ComposerView, right: ComposerView): boolean =>
  left.draft === right.draft &&
  left.attachmentIds.length === right.attachmentIds.length &&
  left.attachmentIds.every((id, index) => right.attachmentIds[index] === id)

type WatchEvent = { readonly type: 'composerChanged' } | { readonly type: 'uploadsReady' } | { readonly type: 'uploadFailed' }

type PendingSendEvent = { readonly type: 'request' } | { readonly type: 'cancel' } | { readonly type: 'dismiss' } | WatchEvent

interface PendingSendContext {
  readonly ports: PendingSendPorts
  readonly requested: ComposerView | null
  readonly failure: 'upload' | 'send' | 'timeout' | null
}

/**
 * idle → waiting → sending → idle. A request captures the composer as it was when Enter was pressed; any edit to the
 * text or the attachments while waiting cancels, because the user is no longer asking to send that message. Leaving
 * `waiting` stops its watcher, so a late upload event can never send a cancelled message.
 */
// SAFETY: xstate's `types` entries are empty type carriers; nothing reads their values.
const pendingSendMachine = setup({
  types: {
    input: {} as PendingSendPorts,
    context: {} as PendingSendContext,
    events: {} as PendingSendEvent,
  },
  actors: {
    watch: fromCallback<WatchEvent, { readonly ports: PendingSendPorts; readonly requested: ComposerView }>(({ input, sendBack }) => {
      const check = (): void => {
        if (!sameComposer(input.requested, input.ports.composer.getSnapshot())) return sendBack({ type: 'composerChanged' })
        const status = input.ports.uploads.status(input.requested.attachmentIds)
        if (status === 'ready') sendBack({ type: 'uploadsReady' })
        if (status === 'failed') sendBack({ type: 'uploadFailed' })
      }
      const stopComposer = input.ports.composer.subscribe(check)
      const stopUploads = input.ports.uploads.subscribe(check)
      check()
      return () => {
        stopComposer()
        stopUploads()
      }
    }),
    submit: fromPromise<void, { readonly ports: PendingSendPorts }>(({ input }) => input.ports.submit()),
  },
  delays: { uploadTimeout: UPLOAD_TIMEOUT_MS },
}).createMachine({
  id: 'pendingSend',
  context: ({ input }) => ({ ports: input, requested: null, failure: null }),
  initial: 'idle',
  states: {
    idle: {
      entry: assign({ requested: null }),
      on: { request: { target: 'waiting' } },
    },
    waiting: {
      entry: assign(({ context }) => ({ requested: context.ports.composer.getSnapshot(), failure: null })),
      invoke: {
        src: 'watch',
        input: ({ context }) => {
          if (context.requested === null) throw new Error('a pending send has no captured composer')
          return { ports: context.ports, requested: context.requested }
        },
      },
      after: { uploadTimeout: { target: 'failed', actions: assign({ failure: 'timeout' }) } },
      on: {
        cancel: 'idle',
        composerChanged: 'idle',
        uploadsReady: 'sending',
        uploadFailed: { target: 'failed', actions: assign({ failure: 'upload' }) },
      },
    },
    sending: {
      invoke: {
        src: 'submit',
        input: ({ context }) => ({ ports: context.ports }),
        onDone: 'idle',
        onError: { target: 'failed', actions: assign({ failure: 'send' }) },
      },
    },
    failed: {
      on: { dismiss: 'idle', cancel: 'idle', request: 'waiting' },
    },
  },
})

export type PendingSendActor = ActorRefFrom<typeof pendingSendMachine>

export const startPendingSend = (ports: PendingSendPorts): PendingSendActor => createActor(pendingSendMachine, { input: ports }).start()
