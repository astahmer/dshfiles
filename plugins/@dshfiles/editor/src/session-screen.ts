import type { SessionScreenService, Subscribable, WorkspaceEntry, WorkspaceFilesState, WorkspaceSearchHit } from '@dshfiles/dshx/client'
import * as Option from 'effect/Option'
import * as Schema from 'effect/Schema'

export const listingSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Struct({ entries: Schema.Array(Schema.Struct({ name: Schema.String, type: Schema.Literals(['file', 'directory', 'other']) })) }),
})
export const searchSchema = Schema.Struct({
  ok: Schema.Literal(true),
  value: Schema.Array(Schema.Struct({ path: Schema.String, kind: Schema.Literals(['file', 'directory']) })),
})

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
        const listing = Schema.decodeUnknownOption(listingSchema)(
          await input.list(sessionId, request.path === '' ? '.' : request.path, request.signal).catch(() => undefined),
        )
        if (Option.isNone(listing)) return undefined
        return listing.value.value.entries.map((entry): WorkspaceEntry => ({
          name: entry.name,
          path: request.path === '' ? entry.name : `${request.path}/${entry.name}`,
          type: entry.type,
        }))
      },
      search: async request => {
        const sessionId = target(request.sessionId)
        if (sessionId === undefined) return []
        const hits = Schema.decodeUnknownOption(searchSchema)(await input.search(sessionId, request.query, request.signal).catch(() => undefined))
        return Option.isSome(hits) ? hits.value.value.map((hit): WorkspaceSearchHit => ({ path: hit.path, kind: hit.kind })) : []
      },
    },
  }
}
