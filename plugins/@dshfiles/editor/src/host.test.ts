import { isApiError } from '@dshfiles/dshx/api'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem } from 'effect'
import { editorApi } from './api.js'
import plugin from './host.js'

const mountedEditor = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const workspace = yield* fs.makeTempDirectoryScoped({ prefix: 'dshfiles-editor-host-' })
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  const live = new Map([['session-live', { header: { cwd: workspace } }]])
  // SAFETY: the editor reads only `get` of the live session store and `stat` of the persisted one.
  const releaseSessions = host.ctx.provide('sessions', { get: (sessionId: string) => live.get(sessionId) } as never)
  // SAFETY: as above; no session is persisted in this Host.
  const releasePersistence = host.ctx.provide('sessionPersistence', { stat: () => Promise.resolve(undefined) } as never)
  // SAFETY: the editor's settings contribution only registers its automatic page through `configure`.
  const releaseSettings = host.ctx.provide('settings', { configure: () => () => undefined } as never)
  yield* Effect.addFinalizer(() =>
    Effect.sync(() => {
      releaseSessions()
      releasePersistence()
      releaseSettings()
    }),
  )
  yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/editor' }))
  return { fs, workspace, client: createHostApiClient(host.ctx, editorApi, '@dshfiles/editor') }
}).pipe(Effect.provide(NodeServices.layer))

const remoteFailure = (call: () => Promise<unknown>) =>
  Effect.flip(Effect.tryPromise({ try: call, catch: error => (isApiError(error) ? error : new Error('not an ApiError')) }))

describe('editor Host', () => {
  it.live('saves into the named session workspace and reports a conflict as a result', () =>
    Effect.gen(function* () {
      const { fs, workspace, client } = yield* mountedEditor
      const saved = yield* Effect.promise(() => client.write({ sessionId: 'session-live', path: 'notes.md', text: 'hello', expectedSha256: null }))
      expect(saved).toMatchObject({ status: 'saved', bytes: 5 })
      expect(yield* fs.readFileString(`${workspace}/notes.md`)).toBe('hello')
      const conflict = yield* Effect.promise(() => client.write({ sessionId: 'session-live', path: 'notes.md', text: 'again', expectedSha256: null }))
      expect(conflict).toMatchObject({ status: 'conflict' })
    }).pipe(Effect.provide(NodeServices.layer)),
  )

  it.live('exposes refusals under their domain wire codes', () =>
    Effect.gen(function* () {
      const { client } = yield* mountedEditor
      expect(yield* remoteFailure(() => client.write({ path: 'notes.md', text: 'x', expectedSha256: null }))).toMatchObject({
        remoteCode: 'session-required',
        message: 'Pass sessionId: this tool cannot tell which thread workspace to save into.',
      })
      expect(yield* remoteFailure(() => client.write({ sessionId: 'session-gone', path: 'notes.md', text: 'x', expectedSha256: null }))).toMatchObject({
        remoteCode: 'session-workspace-missing',
        message: 'This session has no workspace directory to save into.',
      })
      expect(yield* remoteFailure(() => client.write({ sessionId: 'session-live', path: '../escape.md', text: 'x', expectedSha256: null }))).toMatchObject({
        remoteCode: 'outside-workspace',
        message: 'Path is outside the session workspace.',
      })
    }),
  )
})
