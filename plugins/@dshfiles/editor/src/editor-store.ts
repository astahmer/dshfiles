import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { resolveRequestedPath, type OpenFileRequest } from './open-file.js'

export const MAX_EDITABLE_BYTES = 5 * 1024 * 1024

export interface OpenDocument {
  readonly id: string
  readonly sessionId: SessionId
  readonly path: string
  readonly name: string
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: string
  /** Text as loaded; the live buffer belongs to the editor engine. */
  readonly text: string
  /** sha256 of the bytes on disk the buffer is based on; null for a file that does not exist yet. */
  readonly sha256: string | null
  readonly version: string | null
  readonly dirty: boolean
  /** The file changed on disk while the buffer had unsaved edits. */
  readonly diskChanged: boolean
  /** Bumped on every open request so the panel re-reveals the line even for an already open file. */
  readonly reveal: { readonly line: number; readonly request: number } | null
}

export interface EditorState {
  readonly documents: readonly OpenDocument[]
  readonly activeBySession: Readonly<Record<string, string>>
}

type Remote = Pick<ClientRemote, 'workspaceFiles'>

const documentId = (sessionId: string, path: string): string => sessionId + '\n' + path

const baseName = (path: string): string => path.split('/').filter(Boolean).at(-1) ?? path

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<string> => {
  if (globalThis.crypto?.subtle === undefined) throw new Error('Saving needs a secure context (https or localhost) for content hashing.')
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Open files across sessions. Content comes from the Host `workspaceFiles` namespace (`readBytes`, so the exact
 * bytes — trailing newline included — are what the editor hashes and later saves over); each open file is watched
 * through `changes` and reloads when clean, or is flagged when it has unsaved edits.
 */
export const createEditorStore = (remote: Remote) => {
  let state: EditorState = { documents: [], activeBySession: {} }
  let requests = 0
  const listeners = new Set<() => void>()
  const watches = new Map<string, AbortController>()

  const set = (next: EditorState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const patch = (id: string, change: Partial<OpenDocument>): void =>
    set({ ...state, documents: state.documents.map(document => (document.id === id ? { ...document, ...change } : document)) })
  const find = (id: string): OpenDocument | undefined => state.documents.find(document => document.id === id)

  const load = async (id: string, signal?: AbortSignal): Promise<void> => {
    const document = find(id)
    if (document === undefined) return
    const result = await remote.workspaceFiles.readBytes(document.sessionId, document.path, {}, signal)
    if (find(id) === undefined) return
    if (!result.ok) {
      if (result.error.code === 'workspace-file/not-found') {
        patch(id, { status: 'ready', text: '', sha256: null, version: null, dirty: false, diskChanged: false })
        return
      }
      patch(id, { status: 'error', error: result.error.message })
      return
    }
    if (result.value.data.byteLength > MAX_EDITABLE_BYTES) {
      patch(id, { status: 'error', error: `File is larger than ${MAX_EDITABLE_BYTES / 1024 / 1024} MB; the editor does not open it.` })
      return
    }
    let text: string
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(result.value.data)
    } catch {
      patch(id, { status: 'error', error: 'Binary or non-UTF-8 file; the editor only opens text.' })
      return
    }
    patch(id, { status: 'ready', text, sha256: await sha256(result.value.data), version: result.value.version, dirty: false, diskChanged: false })
  }

  const watch = (id: string, sessionId: SessionId, path: string): void => {
    const controller = new AbortController()
    watches.set(id, controller)
    void (async () => {
      try {
        for await (const frame of remote.workspaceFiles.changes(sessionId, path, controller.signal)) {
          const document = find(id)
          if (document === undefined || frame.kind !== 'change') continue
          if ('absent' in frame.change || frame.change.version === document.version) continue
          if (!document.dirty) {
            await load(id, controller.signal)
            continue
          }
          // A dirty buffer keeps its edits; flag the change unless the disk now holds what this editor saved.
          const current = await remote.workspaceFiles.readBytes(sessionId, path, {}, controller.signal)
          if (current.ok && (await sha256(current.value.data)) === find(id)?.sha256) patch(id, { version: current.value.version })
          else patch(id, { diskChanged: true })
        }
      } catch {
        // Watching is best effort: a file outside the workspace has no change feed.
      }
    })()
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: (): EditorState => state,
    open: (sessionId: SessionId, request: OpenFileRequest): void => {
      const path = resolveRequestedPath(request)
      const id = documentId(sessionId, path)
      const reveal = request.line === undefined ? null : { line: request.line, request: ++requests }
      const activeBySession = { ...state.activeBySession, [sessionId]: id }
      if (find(id) !== undefined) {
        set({
          ...state,
          activeBySession,
          documents: state.documents.map(document => (document.id === id && reveal !== null ? { ...document, reveal } : document)),
        })
        return
      }
      const document: OpenDocument = {
        id,
        sessionId,
        path,
        name: baseName(path),
        status: 'loading',
        text: '',
        sha256: null,
        version: null,
        dirty: false,
        diskChanged: false,
        reveal,
      }
      set({ documents: [...state.documents, document], activeBySession })
      void load(id).then(() => {
        if (find(id)?.status === 'ready') watch(id, sessionId, path)
      })
    },
    activate: (sessionId: SessionId, id: string): void => set({ ...state, activeBySession: { ...state.activeBySession, [sessionId]: id } }),
    close: (id: string): void => {
      watches.get(id)?.abort()
      watches.delete(id)
      const closing = find(id)
      const documents = state.documents.filter(document => document.id !== id)
      const activeBySession = { ...state.activeBySession }
      if (closing !== undefined && activeBySession[closing.sessionId] === id) {
        const fallback = documents.filter(document => document.sessionId === closing.sessionId).at(-1)
        if (fallback === undefined) delete activeBySession[closing.sessionId]
        else activeBySession[closing.sessionId] = fallback.id
      }
      set({ documents, activeBySession })
    },
    setDirty: (id: string, dirty: boolean): void => {
      if (find(id)?.dirty !== dirty) patch(id, { dirty })
    },
    saved: (id: string, sha: string): void => patch(id, { sha256: sha, diskChanged: false }),
    keepMine: (id: string): void => patch(id, { diskChanged: false }),
    reload: (id: string): Promise<void> => load(id),
    dispose: (): void => {
      for (const controller of watches.values()) controller.abort()
      watches.clear()
      listeners.clear()
    },
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
