import { relativeTime } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ApiClient } from '@dshfiles/dshx/api'
import { isApiError, isApiOwnerMissing } from '@dshfiles/dshx/api'
import type { whiteboardApi } from './api.js'
import { SaveConflict, type SaveBoard } from './board-sync-machine.js'
import { sceneByteLimit } from './model.js'

export type WhiteboardClient = Omit<ApiClient<typeof whiteboardApi.methods>, 'safe'>

/** One registered project the page can file boards under. */
export interface ProjectChoice {
  readonly path: string
  readonly title: string
}

const relativeUnits = { minutes: 'minute', hours: 'hour', days: 'day', months: 'month', years: 'year' } as const
const relativeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })

/** Query keys, polling, the autosave port and display text shared by the Whiteboards page and the board view. */
export class WhiteboardUi {
  static readonly keys = {
    all: ['whiteboard'] as const,
    list: (project: string | null) => ['whiteboard', 'list', project] as const,
    board: (boardId: string) => ['whiteboard', 'board', boardId] as const,
    editor: ['whiteboard', 'editor'] as const,
  }

  /** Poll for agent writes every few seconds, and stop once the Host bundle is missing instead of logging 404s. */
  static pollingInterval(interval: number): (query: { readonly state: { readonly error: unknown } }) => number | false {
    return query => (isApiOwnerMissing(query.state.error instanceof Error ? query.state.error : null) ? false : interval)
  }

  /** The autosave port: a revision-checked write whose stale-revision refusal becomes a {@link SaveConflict}. */
  static saveWith(api: WhiteboardClient): SaveBoard {
    return async (request, signal) => {
      if (new TextEncoder().encode(JSON.stringify(request.scene)).byteLength > sceneByteLimit)
        throw new Error('This board is larger than the 900 KiB a whiteboard can save, usually because of large images. Remove or crop an image, then Retry.')
      try {
        const write: Parameters<WhiteboardClient['write']>[0] = {
          boardId: request.boardId,
          expectedRevision: request.expectedRevision,
          elements: request.scene.elements,
          appState: request.scene.appState,
          files: request.scene.files,
        }
        return await api.write(request.clearPending ? { ...write, clearPending: true } : write, { signal })
      } catch (cause) {
        if (isApiError(cause) && cause.remoteCode === 'stale-revision') {
          const current = await api.read({ boardId: request.boardId }, { signal })
          throw new SaveConflict(current.board.revision)
        }
        throw cause
      }
    }
  }

  static pendingLabel(pending: 'mermaid' | 'skeleton'): string {
    return pending === 'mermaid' ? 'Mermaid queued' : 'Shapes queued'
  }

  /** “just now”, “5 minutes ago”, “yesterday”: the Host's relative-time bucket in the browser's language. */
  static editedAgo(at: number, now: number): string {
    const bucket = relativeTime(at, now)
    return bucket.unit === 'now' ? 'just now' : relativeFormat.format(-bucket.n, relativeUnits[bucket.unit])
  }
}
