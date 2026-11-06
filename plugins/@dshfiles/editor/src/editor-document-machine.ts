import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { assign, fromCallback, fromPromise, setup } from '@dshfiles/plugin-ui/machine'
import { errorMessage } from '@dshfiles/plugin-ui/query'

const MAX_EDITABLE_BYTES = 5 * 1024 * 1024

const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
}

/** What the panel shows: text goes to the editor engine; images and other binary files never reach it. */
export type DocumentContent =
  | { readonly kind: 'text' }
  | { readonly kind: 'image'; readonly url: string; readonly bytes: number }
  | { readonly kind: 'binary'; readonly bytes: number | null }

type WorkspaceFilesRemote = Pick<ClientRemote, 'workspaceFiles'>

export interface DocumentMachineInput {
  readonly remote: WorkspaceFilesRemote
  readonly sessionId: SessionId
  readonly path: string
}

interface DocumentContext {
  readonly remote: WorkspaceFilesRemote
  readonly sessionId: SessionId
  readonly path: string
  readonly absolutePath: string | null
  readonly content: DocumentContent
  readonly text: string
  readonly sha256: string | null
  readonly version: string | null
  readonly dirty: boolean
  readonly diskChanged: boolean
  readonly error: string | null
  /** The newest announced disk version that no refresh or reconcile has answered yet. */
  readonly pendingVersion: string | null
}

export type DocumentEvent =
  | { readonly type: 'buffer.edit'; readonly dirty: boolean }
  | { readonly type: 'document.saved'; readonly sha256: string }
  | { readonly type: 'disk.keepMine' }
  | { readonly type: 'document.reload' }
  | { readonly type: 'disk.frame'; readonly version: string }

type DocumentView =
  | {
      readonly kind: 'document'
      readonly absolutePath: string | null
      readonly content: DocumentContent
      readonly text: string
      readonly sha256: string | null
      readonly version: string | null
    }
  | { readonly kind: 'error'; readonly message: string }

interface ReadInput {
  readonly remote: WorkspaceFilesRemote
  readonly sessionId: SessionId
  readonly path: string
  readonly absolutePath: string | null
}

type ReconcileResult = { readonly kind: 'unchanged'; readonly version: string } | { readonly kind: 'changed' }

interface ReconcileInput {
  readonly remote: WorkspaceFilesRemote
  readonly sessionId: SessionId
  readonly path: string
  readonly sha256: string | null
}

interface WatchInput {
  readonly remote: WorkspaceFilesRemote
  readonly sessionId: SessionId
  readonly path: string
}

type LoadedView = Extract<DocumentView, { readonly kind: 'document' }>

const loadedContext = (view: LoadedView): Partial<DocumentContext> => ({
  absolutePath: view.absolutePath,
  content: view.content,
  text: view.text,
  sha256: view.sha256,
  version: view.version,
  dirty: false,
  diskChanged: false,
  error: null,
})

const failedContext = (message: string): Partial<DocumentContext> => ({
  error: message,
  content: { kind: 'text' },
  text: '',
  sha256: null,
  version: null,
  dirty: false,
  diskChanged: false,
})

const imageType = (path: string): string | undefined => IMAGE_TYPES[path.split('.').at(-1)?.toLowerCase() ?? '']

/** A newer announced version that no refresh or reconcile has answered yet. */
const pendingDiffers = (context: DocumentContext): boolean => context.pendingVersion !== null && context.pendingVersion !== context.version

const decodeText = (data: Uint8Array): string | undefined => {
  if (data.includes(0)) return undefined
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data)
  } catch {
    return undefined
  }
}

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  if (globalThis.crypto?.subtle === undefined) throw new Error('Saving needs a secure context (https or localhost) for content hashing.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

const read = fromPromise<DocumentView, ReadInput>(async ({ input, signal }) => {
  const result = await input.remote.workspaceFiles.readBytes(input.sessionId, input.path, {}, signal)
  if (!result.ok) {
    if (result.error.code === 'workspace-file/not-found')
      return { kind: 'document', absolutePath: input.absolutePath, content: { kind: 'text' }, text: '', sha256: null, version: null }
    if (result.error.code === 'workspace-file/too-large') {
      const stat = await input.remote.workspaceFiles.stat(input.sessionId, input.path, signal)
      return {
        kind: 'document',
        absolutePath: stat.ok ? stat.value.absolutePath : input.absolutePath,
        content: { kind: 'binary', bytes: stat.ok ? (stat.value.bytes ?? null) : null },
        text: '',
        sha256: null,
        version: stat.ok ? stat.value.version : null,
      }
    }
    return { kind: 'error', message: result.error.message }
  }
  const data = result.value.data
  const mime = imageType(input.path)
  if (mime !== undefined) {
    const url = URL.createObjectURL(new Blob([data], { type: mime }))
    return {
      kind: 'document',
      absolutePath: result.value.absolutePath,
      content: { kind: 'image', url, bytes: data.byteLength },
      text: '',
      sha256: null,
      version: result.value.version,
    }
  }
  const text = decodeText(data)
  if (text === undefined)
    return {
      kind: 'document',
      absolutePath: result.value.absolutePath,
      content: { kind: 'binary', bytes: data.byteLength },
      text: '',
      sha256: null,
      version: result.value.version,
    }
  if (data.byteLength > MAX_EDITABLE_BYTES)
    return { kind: 'error', message: `File is larger than ${MAX_EDITABLE_BYTES / 1024 / 1024} MB; the editor does not open it.` }
  return {
    kind: 'document',
    absolutePath: result.value.absolutePath,
    content: { kind: 'text' },
    text,
    sha256: await sha256(result.value.data),
    version: result.value.version,
  }
})

/**
 * Compare the disk with the sha the buffer was saved from, so a dirty tab flags a foreign edit instead of dropping
 * its own. A failed read counts as a change: the buffer cannot claim the disk still holds it.
 */
const reconcile = fromPromise<ReconcileResult, ReconcileInput>(async ({ input, signal }) => {
  const current = await input.remote.workspaceFiles.readBytes(input.sessionId, input.path, {}, signal).catch(() => null)
  if (current === null || !current.ok) return { kind: 'changed' }
  return (await sha256(current.value.data)) === input.sha256 ? { kind: 'unchanged', version: current.value.version } : { kind: 'changed' }
})

const watch = fromCallback<DocumentEvent, WatchInput>(({ input, sendBack }) => {
  const controller = new AbortController()
  void (async () => {
    try {
      for await (const frame of input.remote.workspaceFiles.changes(input.sessionId, input.path, controller.signal)) {
        if (frame.kind !== 'change' || 'absent' in frame.change) continue
        sendBack({ type: 'disk.frame', version: frame.change.version })
      }
    } catch {
      // Watching is best effort: a file outside the workspace has no change feed.
    }
  })()
  return () => controller.abort()
})

export const editorDocumentMachine = setup({
  // SAFETY: XState uses empty carriers for inference; runtime context comes from input and events are typed above.
  types: {
    context: {} as DocumentContext,
    events: {} as DocumentEvent,
    input: {} as DocumentMachineInput,
  },
  actors: { read, reconcile, watch },
  guards: {
    frameIsCurrentVersion: ({ context, event }) => event.type === 'disk.frame' && event.version === context.version,
    /** The buffer has edits, so the disk is only compared, never adopted. */
    bufferIsDirty: ({ context }) => context.dirty,
    pendingNeedsReconcile: ({ context }) => context.dirty && pendingDiffers(context),
    pendingNeedsRefresh: ({ context }) => !context.dirty && pendingDiffers(context),
  },
  actions: {
    markPending: assign(({ event }) => (event.type === 'disk.frame' ? { pendingVersion: event.version } : {})),
    clearPending: assign({ pendingVersion: null }),
    markDiskChanged: assign({ diskChanged: true }),
  },
}).createMachine({
  id: 'editorDocument',
  initial: 'loading',
  context: ({ input }) => ({
    remote: input.remote,
    sessionId: input.sessionId,
    path: input.path,
    absolutePath: null,
    content: { kind: 'text' },
    text: '',
    sha256: null,
    version: null,
    dirty: false,
    diskChanged: false,
    error: null,
    pendingVersion: null,
  }),
  invoke: {
    src: 'watch',
    input: ({ context }) => ({ remote: context.remote, sessionId: context.sessionId, path: context.path }),
  },
  on: {
    'buffer.edit': { actions: assign(({ event }) => ({ dirty: event.dirty })) },
    'document.saved': { actions: assign(({ event }) => ({ sha256: event.sha256, diskChanged: false })) },
    'disk.keepMine': { actions: assign({ diskChanged: false }) },
  },
  states: {
    loading: {
      invoke: {
        src: 'read',
        input: ({ context }) => ({ remote: context.remote, sessionId: context.sessionId, path: context.path, absolutePath: context.absolutePath }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === 'document',
            target: 'ready',
            actions: assign(({ event }) => (event.output.kind === 'document' ? loadedContext(event.output) : {})),
          },
          { target: 'error', actions: assign(({ event }) => (event.output.kind === 'error' ? failedContext(event.output.message) : {})) },
        ],
        onError: { target: 'error', actions: assign(({ event }) => failedContext(errorMessage(event.error, 'Reading the file failed.'))) },
      },
    },
    ready: {
      always: [
        { guard: 'pendingNeedsReconcile', target: 'reconciling' },
        { guard: 'pendingNeedsRefresh', target: 'refreshing' },
      ],
      on: {
        'document.reload': { target: 'refreshing', actions: 'clearPending' },
        'disk.frame': [
          { guard: 'frameIsCurrentVersion' },
          { guard: 'bufferIsDirty', target: 'reconciling', actions: 'clearPending' },
          { target: 'refreshing', actions: 'clearPending' },
        ],
      },
    },
    refreshing: {
      invoke: {
        src: 'read',
        input: ({ context }) => ({ remote: context.remote, sessionId: context.sessionId, path: context.path, absolutePath: context.absolutePath }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === 'document',
            target: 'ready',
            actions: assign(({ event }) => (event.output.kind === 'document' ? loadedContext(event.output) : {})),
          },
          { target: 'error', actions: assign(({ event }) => (event.output.kind === 'error' ? failedContext(event.output.message) : {})) },
        ],
        onError: { target: 'error', actions: assign(({ event }) => failedContext(errorMessage(event.error, 'Reading the file failed.'))) },
      },
      on: {
        'document.reload': { target: 'refreshing', reenter: true, actions: 'clearPending' },
        'disk.frame': { actions: 'markPending' },
      },
    },
    reconciling: {
      invoke: {
        src: 'reconcile',
        input: ({ context }) => ({ remote: context.remote, sessionId: context.sessionId, path: context.path, sha256: context.sha256 }),
        onDone: [
          {
            guard: ({ event }) => event.output.kind === 'unchanged',
            target: 'ready',
            actions: assign(({ event }) => (event.output.kind === 'unchanged' ? { version: event.output.version } : {})),
          },
          { target: 'ready', actions: 'markDiskChanged' },
        ],
        onError: { target: 'ready' },
      },
      on: { 'disk.frame': { actions: 'markPending' } },
    },
    error: {},
  },
})
