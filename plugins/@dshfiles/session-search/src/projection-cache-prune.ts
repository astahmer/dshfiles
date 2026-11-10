import type { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import { Effect, FileSystem, Path } from 'effect'
import { SessionStore } from './session-store-promise.js'

/**
 * The projection cache keeps one checkpoint per Session and never drops one when its Session is deleted. A checkpoint
 * is the only zero-I/O source of a cold Session's list metadata and title, so only an orphan — a checkpoint whose
 * Session persistence no longer stores — is removed. Orphans appear only when a Session is deleted, so one pass per
 * boot is enough.
 */
export class ProjectionCachePrune {
  static readonly orphans = Effect.fn('projection cache prune orphans')(function* (input: { readonly ctx: Context; readonly root?: string }) {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = input.root ?? dshHomePath('storages', 'session_projcache', 'sessions')
    const persistence = input.ctx.get('sessionPersistence')
    if (persistence === undefined) return 0
    const names = yield* fs.readDirectory(root).pipe(Effect.orElseSucceed((): readonly string[] => []))
    const checkpointIds = names.filter(name => name.endsWith('.json')).map(name => name.slice(0, -'.json'.length))
    if (checkpointIds.length === 0) return 0
    const stored = new Set((yield* SessionStore.list(persistence)).map(snapshot => String(snapshot.header.id)))
    let removed = 0
    for (const id of checkpointIds) {
      if (stored.has(id) || input.ctx.get('sessions')?.get(SessionId(id)) !== undefined) continue
      // A Session created after the listing already has its checkpoint; stat sees it.
      if (yield* SessionStore.exists(persistence, SessionId(id))) continue
      yield* fs.remove(path.join(root, `${id}.json`), { force: true })
      removed += 1
    }
    return removed
  })
}
