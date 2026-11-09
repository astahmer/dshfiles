import type { ClientRemote } from '@deepseek-ai/dsh-api-gateway/client'
import type {} from '@deepseek-ai/dsh-api-workspace-files/remote'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { createActor, type ActorRefFrom } from '@dshfiles/plugin-ui/machine'
import { editorDocumentMachine, type DocumentContent } from './editor-document-machine.js'
import { OpenFileAddress, type OpenFileRequest } from './open-file.js'

export type { DocumentContent }

export interface OpenDocument {
  readonly id: string
  readonly sessionId: SessionId
  /** Workspace-relative when the file lies under the session root, else absolute. */
  readonly path: string
  /** Host `absolutePath` (symlinks resolved) once loaded; the identity two spellings of one file share. */
  readonly absolutePath: string | null
  readonly name: string
  readonly status: 'loading' | 'ready' | 'error'
  readonly error?: string
  readonly content: DocumentContent
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

type EditorDocumentActor = ActorRefFrom<typeof editorDocumentMachine>

interface DocumentBase {
  readonly id: string
  readonly sessionId: SessionId
  readonly path: string
  readonly name: string
  reveal: OpenDocument['reveal']
}

interface DocumentEntry {
  readonly base: DocumentBase
  readonly actor: EditorDocumentActor
  readonly subscription: { unsubscribe: () => void }
}

const documentId = (sessionId: string, path: string): string => sessionId + '\n' + path

const baseName = (path: string): string => path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path

/**
 * Open files across sessions. Content comes from the Host `workspaceFiles` namespace (`readBytes`, so the exact
 * bytes — trailing newline included — are what the editor hashes and later saves over); each open file is watched
 * through `changes` and reloads when clean, or is flagged when it has unsaved edits. One document actor owns that
 * lifecycle, so a read, reload or watch frame that outlives its document is cancelled with it.
 */
export const createEditorStore = (options: {
  readonly remote: Remote
  /** The session's workspace directory as the Client knows it (`sessions.list` summary `cwd`). */
  readonly workspaceRoot?: (sessionId: SessionId) => string | undefined
}) => {
  const remote = options.remote
  let state: EditorState = { documents: [], activeBySession: {} }
  let requests = 0
  const listeners = new Set<() => void>()
  const entries = new Map<string, DocumentEntry>()
  // Symlink-resolved roots learnt from loads, e.g. `/private/tmp/w` for a session whose cwd is `/tmp/w`.
  const resolvedRoots = new Map<string, Set<string>>()

  const rootsOf = (sessionId: SessionId): readonly string[] => {
    const configured = options.workspaceRoot?.(sessionId)
    return [...(configured === undefined ? [] : [configured]), ...(resolvedRoots.get(sessionId) ?? [])]
  }

  const set = (next: EditorState): void => {
    state = next
    for (const listener of listeners) listener()
  }
  const releaseContent = (document: OpenDocument | undefined): void => {
    if (document?.content.kind === 'image') URL.revokeObjectURL(document.content.url)
  }
  const find = (id: string): OpenDocument | undefined => state.documents.find(document => document.id === id)

  const project = (entry: DocumentEntry): OpenDocument => {
    const snapshot = entry.actor.getSnapshot()
    const context = snapshot.context
    const status = snapshot.matches('error') ? 'error' : snapshot.matches('loading') ? 'loading' : 'ready'
    const document: OpenDocument = {
      ...entry.base,
      absolutePath: context.absolutePath,
      status,
      content: context.content,
      text: context.text,
      sha256: context.sha256,
      version: context.version,
      dirty: context.dirty,
      diskChanged: context.diskChanged,
    }
    return status === 'error' ? { ...document, error: context.error ?? '' } : document
  }

  const learnRoot = (sessionId: SessionId, path: string, absolutePath: string): void => {
    if (path.startsWith('/') || !absolutePath.endsWith('/' + path)) return
    const root = absolutePath.slice(0, -(path.length + 1))
    if (root === '') return
    const roots = resolvedRoots.get(sessionId) ?? new Set()
    roots.add(root)
    resolvedRoots.set(sessionId, roots)
  }

  const destroy = (id: string): void => {
    const entry = entries.get(id)
    if (entry === undefined) return
    entries.delete(id)
    entry.subscription.unsubscribe()
    entry.actor.stop()
    releaseContent(project(entry))
  }

  /** A second spelling of an open file resolved to the same Host path: keep the first tab, drop this one. */
  const mergeIntoTwin = (id: string, absolutePath: string): boolean => {
    const document = find(id)
    if (document === undefined) return false
    const twin = state.documents.find(other => other.id !== id && other.sessionId === document.sessionId && other.absolutePath === absolutePath)
    if (twin === undefined) return false
    const activeBySession = { ...state.activeBySession }
    if (activeBySession[document.sessionId] === id) activeBySession[document.sessionId] = twin.id
    const reveal = document.reveal === null ? twin.reveal : { line: document.reveal.line, request: ++requests }
    const documents = state.documents.filter(other => other.id !== id).map(other => (other.id === twin.id ? { ...other, reveal } : other))
    set({ activeBySession, documents })
    destroy(id)
    return true
  }

  const syncDocument = (id: string): void => {
    const entry = entries.get(id)
    const previous = find(id)
    if (entry === undefined || previous === undefined) return
    const next = project(entry)
    if (next.absolutePath !== null && next.absolutePath !== previous.absolutePath) {
      learnRoot(entry.base.sessionId, entry.base.path, next.absolutePath)
      if (mergeIntoTwin(id, next.absolutePath)) return
    }
    if (next.content !== previous.content && previous.content.kind === 'image') URL.revokeObjectURL(previous.content.url)
    set({ ...state, documents: state.documents.map(document => (document.id === id ? next : document)) })
  }

  const closeDocument = (id: string): void => {
    const closing = find(id)
    destroy(id)
    if (closing === undefined) return
    const documents = state.documents.filter(document => document.id !== id)
    const activeBySession = { ...state.activeBySession }
    if (activeBySession[closing.sessionId] === id) {
      const fallback = documents.filter(document => document.sessionId === closing.sessionId).at(-1)
      if (fallback === undefined) delete activeBySession[closing.sessionId]
      else activeBySession[closing.sessionId] = fallback.id
    }
    set({ documents, activeBySession })
  }

  return {
    subscribe: (listener: () => void): (() => void) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: (): EditorState => state,
    open: (sessionId: SessionId, request: OpenFileRequest): void => {
      const roots = rootsOf(sessionId)
      const path = OpenFileAddress.resolve(request, roots)
      const spellings = new Set(path.startsWith('/') ? [path] : [path, ...roots.map(root => root.replace(/\/+$/, '') + '/' + path)])
      const existing = state.documents.find(
        document =>
          document.sessionId === sessionId && (spellings.has(document.path) || (document.absolutePath !== null && spellings.has(document.absolutePath))),
      )
      const id = existing?.id ?? documentId(sessionId, path)
      const reveal = request.line === undefined ? null : { line: request.line, request: ++requests }
      const activeBySession = { ...state.activeBySession, [sessionId]: id }
      if (existing !== undefined) {
        const entry = entries.get(id)
        if (entry !== undefined) entry.base.reveal = reveal
        set({
          ...state,
          activeBySession,
          documents: state.documents.map(document => (document.id === id && reveal !== null ? { ...document, reveal } : document)),
        })
        return
      }
      const base: DocumentBase = { id, sessionId, path, name: baseName(path), reveal }
      const actor = createActor(editorDocumentMachine, { input: { remote, sessionId, path } })
      const entry: DocumentEntry = {
        base,
        actor,
        subscription: actor.subscribe(() => syncDocument(id)),
      }
      entries.set(id, entry)
      actor.start()
      set({ documents: [...state.documents, project(entry)], activeBySession })
    },
    activate: (sessionId: SessionId, id: string): void => set({ ...state, activeBySession: { ...state.activeBySession, [sessionId]: id } }),
    close: (id: string): void => closeDocument(id),
    setDirty: (id: string, dirty: boolean): void => {
      entries.get(id)?.actor.send({ type: 'buffer.edit', dirty })
    },
    saved: (id: string, sha: string): void => {
      entries.get(id)?.actor.send({ type: 'document.saved', sha256: sha })
    },
    keepMine: (id: string): void => {
      entries.get(id)?.actor.send({ type: 'disk.keepMine' })
    },
    reload: (id: string): Promise<void> => {
      entries.get(id)?.actor.send({ type: 'document.reload' })
      return Promise.resolve()
    },
    dispose: (): void => {
      for (const id of [...entries.keys()]) destroy(id)
      listeners.clear()
    },
  }
}

export type EditorStore = ReturnType<typeof createEditorStore>
