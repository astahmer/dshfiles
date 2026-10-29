import type { SessionScreenService, Subscribable, WorkspaceEntry, WorkspaceFilesState, WorkspaceSearchHit } from '@dshfiles/dshx/client'
import { z } from 'zod'

const listingSchema = z.object({
  ok: z.literal(true),
  value: z.object({ entries: z.array(z.object({ name: z.string(), type: z.enum(['file', 'directory', 'other']) })) }),
})
const searchSchema = z.object({ ok: z.literal(true), value: z.array(z.object({ path: z.string(), kind: z.enum(['file', 'directory']) })) })

const NO_SESSION: WorkspaceFilesState = { status: 'no-session' }

/**
 * Provides dshx's `SessionScreen` over the editor's workspace file index: the walk ⌘P already shares, one Host list
 * per tree level, and the Host's `@` mention search.
 */
export const createSessionScreen = <SessionId extends string>(input: {
  readonly current: Subscribable<string | undefined>
  readonly mounted: Subscribable<SessionId | undefined>
  readonly fileIndex: { request(sessionId: SessionId, listener: (reply: WorkspaceFilesState) => void): () => void }
  readonly asSessionId: (id: string) => SessionId
  readonly list: (sessionId: SessionId, path: string, signal: AbortSignal | undefined) => Promise<unknown>
  readonly search: (sessionId: SessionId, query: string, signal: AbortSignal | undefined) => Promise<unknown>
}): SessionScreenService => {
  let state: WorkspaceFilesState = NO_SESSION
  const listeners = new Set<() => void>()
  let following: { readonly sessionId: SessionId | undefined; readonly stop: () => void } | undefined
  const publish = (next: WorkspaceFilesState): void => {
    state = next
    for (const listener of [...listeners]) listener()
  }
  const follow = (): void => {
    const sessionId = input.mounted.get()
    if (following !== undefined && following.sessionId === sessionId) return
    following?.stop()
    if (sessionId === undefined) {
      following = { sessionId, stop: () => {} }
      publish(NO_SESSION)
      return
    }
    following = { sessionId, stop: input.fileIndex.request(sessionId, publish) }
  }
  let stopMounted: (() => void) | undefined

  const target = (sessionId: string | undefined): SessionId | undefined => (sessionId === undefined ? input.mounted.get() : input.asSessionId(sessionId))

  return {
    current: input.current,
    mounted: input.mounted,
    files: {
      index: {
        get: () => state,
        subscribe: listener => {
          listeners.add(listener)
          if (listeners.size === 1) {
            stopMounted = input.mounted.subscribe(follow)
            follow()
          }
          return () => {
            listeners.delete(listener)
            if (listeners.size > 0) return
            stopMounted?.()
            following?.stop()
            following = undefined
          }
        },
      },
      list: async request => {
        const sessionId = target(request.sessionId)
        if (sessionId === undefined) return undefined
        const listing = listingSchema.safeParse(await input.list(sessionId, request.path === '' ? '.' : request.path, request.signal).catch(() => undefined))
        if (!listing.success) return undefined
        return listing.data.value.entries.map((entry): WorkspaceEntry => ({
          name: entry.name,
          path: request.path === '' ? entry.name : `${request.path}/${entry.name}`,
          type: entry.type,
        }))
      },
      search: async request => {
        const sessionId = target(request.sessionId)
        if (sessionId === undefined) return []
        const hits = searchSchema.safeParse(await input.search(sessionId, request.query, request.signal).catch(() => undefined))
        return hits.success ? hits.data.value.map((hit): WorkspaceSearchHit => ({ path: hit.path, kind: hit.kind })) : []
      },
    },
  }
}
