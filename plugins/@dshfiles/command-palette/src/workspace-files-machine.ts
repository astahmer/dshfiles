import { assign, fromCallback, setup, useMachine } from '@dshfiles/plugin-ui/machine'
import { useEffect, useMemo } from 'react'
import { z } from 'zod'
import { PaletteRules } from './palette.js'

const filesReplySchema = z.union([
  z.object({ status: z.literal('no-session') }),
  z.object({
    status: z.enum(['indexing', 'ready']),
    sessionId: z.string().min(1).max(256),
    files: z.array(z.string().min(1).max(4096)).max(50_000),
    truncated: z.boolean(),
  }),
])

export type WorkspaceFilesReply = z.infer<typeof filesReplySchema>

export interface FilesState {
  readonly status: 'loading' | 'indexing' | 'ready' | 'no-session' | 'unavailable'
  readonly sessionId: string | null
  readonly files: readonly string[]
  readonly truncated: boolean
}

interface WorkspaceFilesClient {
  readonly requestFiles: (respond: (reply: WorkspaceFilesReply) => void, signal: AbortSignal) => boolean
}

interface WorkspaceFilesInput {
  readonly client: WorkspaceFilesClient
}

interface WorkspaceFilesContext {
  readonly client: WorkspaceFilesClient
  readonly requestId: number
  readonly files: FilesState
}

type WorkspaceFilesEvent =
  | { readonly type: 'enable' }
  | { readonly type: 'disable' }
  | { readonly type: 'reply'; readonly requestId: number; readonly files: FilesState }
  | { readonly type: 'unavailable'; readonly requestId: number }

const NO_FILES: FilesState = { status: 'loading', sessionId: null, files: [], truncated: false }

// SAFETY: XState uses these empty carriers for inference; runtime values come from the input and typed events.
export const workspaceFilesMachine = setup({
  types: {
    input: {} as WorkspaceFilesInput,
    context: {} as WorkspaceFilesContext,
    events: {} as WorkspaceFilesEvent,
  },
  actors: {
    requestFiles: fromCallback<WorkspaceFilesEvent, { readonly client: WorkspaceFilesClient; readonly requestId: number }>(({ input, sendBack }) => {
      const controller = new AbortController()
      const respond = (reply: WorkspaceFilesReply): void => {
        if (controller.signal.aborted) return
        const files = reply.status === 'no-session' ? { ...NO_FILES, status: 'no-session' as const } : reply
        sendBack({ type: 'reply', requestId: input.requestId, files })
      }
      let handled = false
      try {
        handled = input.client.requestFiles(respond, controller.signal)
      } catch {
        handled = false
      }
      if (!handled) sendBack({ type: 'unavailable', requestId: input.requestId })
      return () => controller.abort()
    }),
  },
  guards: {
    currentReply: ({ context, event }) => (event.type === 'reply' || event.type === 'unavailable') && event.requestId === context.requestId,
  },
  actions: {
    beginRequest: assign(({ context }) => ({ requestId: context.requestId + 1 })),
    updateFiles: assign(({ event }) => (event.type === 'reply' ? { files: event.files } : {})),
    markUnavailable: assign(() => ({ files: { ...NO_FILES, status: 'unavailable' as const } })),
  },
}).createMachine({
  id: 'paletteWorkspaceFiles',
  context: ({ input }) => ({ client: input.client, requestId: 0, files: NO_FILES }),
  initial: 'disabled',
  states: {
    disabled: { on: { enable: { target: 'active', actions: 'beginRequest' } } },
    active: {
      invoke: {
        src: 'requestFiles',
        input: ({ context }) => ({ client: context.client, requestId: context.requestId }),
      },
      on: {
        disable: { target: 'disabled' },
        enable: { target: 'active', reenter: true, actions: 'beginRequest' },
        reply: { guard: 'currentReply', actions: 'updateFiles' },
        unavailable: { guard: 'currentReply', actions: 'markUnavailable' },
      },
    },
  },
})

export const useWorkspaceFiles = (enabled: boolean): FilesState => {
  const client = useMemo<WorkspaceFilesClient>(
    () => ({
      requestFiles: (respond, signal) => {
        const receive = (value: unknown): void => {
          const decoded = filesReplySchema.safeParse(value)
          if (!decoded.success || signal.aborted) return
          respond(decoded.data)
        }
        return !window.dispatchEvent(new CustomEvent(PaletteRules.WORKSPACE_FILES_EVENT, { detail: { respond: receive, signal }, cancelable: true }))
      },
    }),
    [],
  )
  const [snapshot, send] = useMachine(workspaceFilesMachine, { input: { client } })
  useEffect(() => send({ type: enabled ? 'enable' : 'disable' }), [enabled, send])
  return snapshot.context.files
}
