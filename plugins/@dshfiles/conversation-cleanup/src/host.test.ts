import AgentRegistry from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-schedule'
import SessionStore, { SESSION_FORMAT_VERSION, SessionId, type Session } from '@deepseek-ai/dsh-session'
import SandboxPolicyService, { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import { SessionSeq } from '@deepseek-ai/dsh-session/types'
import { apply as applyJsonlPersistence, name as jsonlPersistenceName } from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createHostApiClient } from '@dshfiles/dshx/host'
import { createTestHost } from '@dshfiles/dshx/testing'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, FileSystem, Layer, Path, Schema } from 'effect'

import { cleanupApi } from './cleanup-api.js'
import plugin from './host.js'

const platform = Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)

const fixtureWithCompression = (compression: 'none' | 'zstd') =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const root = yield* fs.realPath(yield* fs.makeTempDirectoryScoped({ prefix: 'conversation-cleanup-host-' }))
    const host = yield* Effect.acquireRelease(
      Effect.promise(() => createTestHost()),
      value => Effect.promise(() => value.dispose()),
    )
    yield* Effect.promise(() => host.ctx.plugin(SessionStore))
    yield* Effect.promise(() => host.ctx.plugin(AgentRegistry))
    yield* Effect.promise(() => host.ctx.plugin(SessionProjectionRegistry))
    const sessionRoot = path.join(root, 'sessions')
    yield* Effect.promise(() => host.ctx.plugin({ name: jsonlPersistenceName, apply: applyJsonlPersistence }, { root: sessionRoot, compression }))
    const lifecycle = { archivedSessionIds: Array<string>(), settledSessionIds: Array<string>() }
    const backend = { active: true }
    const entry = {
      options: { name: '@deepseek-ai/dsh-session-persistence-jsonl', config: { root: { __jsExpr: 'ctx.homePath("sessions")' } } },
      get fiber() {
        return backend.active ? { config: { root: sessionRoot, compression } } : undefined
      },
    }
    // SAFETY: cleanup reads only these exact workspace, settings and configuration members; persistence and Session ownership are real.
    host.ctx.provide('workspaceRegistry', {
      get archivedSessionIds() {
        return lifecycle.archivedSessionIds
      },
    } as never)
    // SAFETY: the descriptor's single namespace is the only Settings operation cleanup uses.
    host.ctx.provide('settings', { describe: () => [{ ns: 'thread-sidebar', value: { settledSessionIds: lifecycle.settledSessionIds } }] } as never)
    // SAFETY: Loader options preserve the raw expression; only the active Fiber exposes validated resolved backend configuration.
    host.ctx.provide('configEditor', { entries: () => [entry], configuration: () => [{ entry, inherited: {}, override: entry.options.config }] } as never)
    yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/conversation-cleanup' }))
    const client = createHostApiClient(host.ctx, cleanupApi, '@test/cleanup')
    const seed = (sessionId: string) =>
      Effect.promise(async () => {
        const handle = await host.ctx.sessionPersistence.create({
          version: SESSION_FORMAT_VERSION,
          id: SessionId(sessionId),
          cwd: root,
          createdAt: Date.now(),
          isSeeded: false,
        })
        await handle.flush()
        await handle.close()
        return SessionId(sessionId)
      })
    return { host, client, lifecycle, root, seed, backend }
  })
const fixture = fixtureWithCompression('none')

const deleteAsAgent = (test: Effect.Success<typeof fixture>, previewId: string, session?: Session) =>
  Effect.promise(() => {
    const tool = test.host.tools.get('conversation_cleanup_delete')
    if (tool === undefined) throw new Error('Cleanup deletion tool was not registered')
    // SAFETY: the real dshx tool adapter reads only signal and the calling Agent id/session to build ApiCaller; authorization reads the real SessionStore and policy service.
    return tool.execute({ previewId, confirm: true }, {
      signal: new AbortController().signal,
      agent: session === undefined ? undefined : { id: session.id, session },
    } as never)
  })

describe('cleanup with native JSONL persistence', () => {
  it.layer(platform)(it => {
    it.effect('deletes the settled OR archived cold logs and native reads stop finding them', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const settled = yield* test.seed('settled-cold')
        const archived = yield* test.seed('archived-cold')
        const retained = yield* test.seed('ordinary-cold')
        test.lifecycle.settledSessionIds = [settled]
        test.lifecycle.archivedSessionIds = [archived]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect(preview.candidates.map(value => value.sessionId).sort()).toEqual([archived, settled].sort())
        const receipt = yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))
        expect(receipt.results.map(value => value.status)).toEqual(['deleted', 'deleted'])
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(settled))).toBeUndefined()
        expect((yield* Effect.promise(() => test.host.ctx.sessionPersistence.list())).map(value => value.header.id)).toEqual([retained])
        yield* Effect.promise(() =>
          expect(test.host.ctx.sessionPersistence.open(archived, 'read')).rejects.toMatchObject({ name: 'SessionPersistenceNotFoundError' }),
        )
        yield* Effect.promise(() =>
          expect(test.host.ctx.sessionPersistence.open(settled, 'write')).rejects.toMatchObject({ name: 'SessionPersistenceNotFoundError' }),
        )
        yield* Effect.promise(() =>
          expect(test.client.delete({ previewId: preview.previewId, confirm: true })).rejects.toMatchObject({ remoteCode: 'stale-preview' }),
        )
      }).pipe(Effect.scoped),
    )
    it.effect('refuses a configured but inactive persistence entry instead of interpreting its raw root expression', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const target = yield* test.seed('inactive-backend-target')
        test.lifecycle.archivedSessionIds = [target]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect(preview.candidates).toMatchObject([{ sessionId: target }])
        test.backend.active = false
        yield* Effect.promise(() => expect(test.client.preview({})).rejects.toMatchObject({ remoteCode: 'unsupported-backend' }))
        yield* Effect.promise(() =>
          expect(test.client.delete({ previewId: preview.previewId, confirm: true })).rejects.toMatchObject({ remoteCode: 'unsupported-backend' }),
        )
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeDefined()
      }).pipe(Effect.scoped),
    )

    it.effect('purges the real native default compressed JSONL encoding', () =>
      Effect.gen(function* () {
        const test = yield* fixtureWithCompression('zstd')
        const target = yield* test.seed('compressed-target')
        test.lifecycle.archivedSessionIds = [target]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect(preview.candidates).toMatchObject([{ sessionId: target }])
        expect((yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))).results).toMatchObject([
          { sessionId: target, status: 'deleted' },
        ])
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeUndefined()
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.list())).toEqual([])
        yield* Effect.promise(() =>
          expect(test.host.ctx.sessionPersistence.open(target, 'write')).rejects.toMatchObject({ name: 'SessionPersistenceNotFoundError' }),
        )
      }).pipe(Effect.scoped),
    )

    it.effect('protects attached Sessions and refuses a competing native write owner', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const loaded = yield* test.seed('loaded')
        const busy = yield* test.seed('busy')
        test.host.ctx.sessions.create(loaded, { meta: { cwd: test.root } })
        test.lifecycle.archivedSessionIds = [loaded, busy]
        const writer = yield* Effect.acquireRelease(
          Effect.promise(() => test.host.ctx.sessionPersistence.open(busy, 'write')),
          value => Effect.promise(() => value.close()),
        )
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect(preview.protectedCount).toBe(1)
        expect(preview.candidates.map(value => value.sessionId)).toEqual([busy])
        const receipt = yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))
        expect(receipt.results).toMatchObject([{ sessionId: busy, status: 'failed' }])
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(loaded))).toBeDefined()
        expect(yield* Effect.promise(() => writer.read())).toMatchObject({ events: [] })
      }).pipe(Effect.scoped),
    )
    it.effect('skips a revised log and a thread whose lifecycle changed after preview', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const changed = yield* test.seed('changed')
        const reopened = yield* test.seed('reopened')
        test.lifecycle.archivedSessionIds = [changed, reopened]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        const writer = yield* Effect.acquireRelease(
          Effect.promise(() => test.host.ctx.sessionPersistence.open(changed, 'write')),
          value => Effect.promise(() => value.close()),
        )
        yield* Effect.promise(() => writer.append([{ type: 'turn/start', seq: SessionSeq(0), time: 1, data: { turn: 1 } }]))
        yield* Effect.promise(() => writer.close())
        test.lifecycle.archivedSessionIds = [changed]
        const receipt = yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))
        expect(receipt.results.map(value => value.status)).toEqual(['skipped', 'skipped'])
        expect((yield* Effect.promise(() => test.host.ctx.sessionPersistence.list())).length).toBe(2)
      }).pipe(Effect.scoped),
    )
    it.effect('protects a Session attached after its preview and refuses an unknown preview', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const loaded = yield* test.seed('late-loaded')
        test.lifecycle.settledSessionIds = [loaded]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        test.host.ctx.sessions.create(loaded, { meta: { cwd: test.root } })
        const receipt = yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))
        expect(receipt.results).toMatchObject([{ sessionId: loaded, status: 'skipped' }])
        yield* Effect.promise(() => expect(test.client.delete({ previewId: 'unknown', confirm: true })).rejects.toMatchObject({ remoteCode: 'stale-preview' }))
      }).pipe(Effect.scoped),
    )
    it.effect('rejects read-only and workspace-write agent callers using the real native sandbox policy', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        yield* Effect.promise(() => test.host.ctx.plugin(SandboxPolicyService, { mode: 'read-only', workspaceRoot: test.root }))
        const target = yield* test.seed('protected-target')
        test.lifecycle.archivedSessionIds = [target]
        const session = test.host.ctx.sessions.create(SessionId('root-caller'), { meta: { cwd: test.root } })
        const preview = yield* Effect.promise(() => test.client.preview({}))
        for (const mode of ['read-only', 'workspace-write'] as const) {
          setSandboxMode(session, mode)
          const result = yield* Effect.exit(deleteAsAgent(test, preview.previewId, session))
          expect(result._tag).toBe('Failure')
          expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeDefined()
        }
        const ownerReceipt = yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))
        expect(ownerReceipt.results).toMatchObject([{ sessionId: target, status: 'deleted' }])
      }).pipe(Effect.scoped),
    )

    it.effect('rejects missing policy, missing Session and agentless tool callers without consuming a preview', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const target = yield* test.seed('missing-authority-target')
        test.lifecycle.archivedSessionIds = [target]
        const session = test.host.ctx.sessions.create(SessionId('no-policy'), { meta: { cwd: test.root } })
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect((yield* Effect.exit(deleteAsAgent(test, preview.previewId, session)))._tag).toBe('Failure')
        expect((yield* Effect.exit(deleteAsAgent(test, preview.previewId)))._tag).toBe('Failure')
        yield* Effect.promise(() => test.host.ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: test.root }))
        const detached = test.host.ctx.sessions.prepare(SessionId('not-published'), { meta: { cwd: test.root } })
        expect((yield* Effect.exit(deleteAsAgent(test, preview.previewId, detached)))._tag).toBe('Failure')
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeDefined()
        expect((yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))).results).toMatchObject([
          { status: 'deleted' },
        ])
      }).pipe(Effect.scoped),
    )

    it.effect('rejects delegated Full-access callers but permits a root Full-access caller', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        yield* Effect.promise(() => test.host.ctx.plugin(SandboxPolicyService, { mode: 'danger-full-access', workspaceRoot: test.root }))
        const target = yield* test.seed('root-authority-target')
        test.lifecycle.settledSessionIds = [target]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        const child = test.host.ctx.sessions.create(SessionId('child-caller'), { meta: { cwd: test.root, origin: 'subagent', delegationDepth: 1 } })
        expect((yield* Effect.exit(deleteAsAgent(test, preview.previewId, child)))._tag).toBe('Failure')
        const root = test.host.ctx.sessions.create(SessionId('permitted-root'), { meta: { cwd: test.root } })
        const result = yield* deleteAsAgent(test, preview.previewId, root)
        expect(result).toMatchObject({ results: [{ sessionId: target, status: 'deleted' }] })
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeUndefined()
      }).pipe(Effect.scoped),
    )

    it.effect('protects cold Sessions with registered schedule or job activity', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const scheduled = yield* test.seed('scheduled-target')
        const working = yield* test.seed('background-target')
        test.lifecycle.archivedSessionIds = [scheduled, working]
        test.host.ctx.on('workspace/session-activity', async ({ sessionId }, next) => [
          ...(sessionId === scheduled ? [{ kind: 'schedule' as const, items: [{ id: 'scheduled-reminder', label: 'Reminder' }] }] : []),
          ...(sessionId === working ? [{ kind: 'job' as const, items: [{ id: 'background-job', label: 'Build' }] }] : []),
          ...(await next()),
        ])
        const preview = yield* Effect.promise(() => test.client.preview({}))
        expect(preview.candidates).toEqual([])
        expect(preview.protectedCount).toBe(2)
        expect((yield* Effect.promise(() => test.host.ctx.sessionPersistence.list())).length).toBe(2)
      }).pipe(Effect.scoped),
    )

    it.effect('skips newly registered activity after a preview and retains the current log', () =>
      Effect.gen(function* () {
        const test = yield* fixture
        const target = yield* test.seed('late-activity-target')
        test.lifecycle.archivedSessionIds = [target]
        const preview = yield* Effect.promise(() => test.client.preview({}))
        test.host.ctx.on('workspace/session-activity', async ({ sessionId }, next) => [
          ...(sessionId === target ? [{ kind: 'schedule' as const, items: [{ id: 'new-reminder', label: 'New reminder' }] }] : []),
          ...(await next()),
        ])
        expect((yield* Effect.promise(() => test.client.delete({ previewId: preview.previewId, confirm: true }))).results).toMatchObject([
          { sessionId: target, status: 'skipped' },
        ])
        expect(yield* Effect.promise(() => test.host.ctx.sessionPersistence.stat(target))).toBeDefined()
      }).pipe(Effect.scoped),
    )

    it('requires explicit irreversible confirmation in its authoritative API schema', () => {
      const input = cleanupApi.methods.delete.input
      if (input === undefined) throw new Error('Cleanup deletion must declare its confirmation schema')
      const decode = Schema.decodeUnknownSync(input)
      expect(() => decode({ previewId: 'preview' })).toThrow()
      expect(() => decode({ previewId: 'preview', confirm: false })).toThrow()
      expect(decode({ previewId: 'preview', confirm: true })).toEqual({ previewId: 'preview', confirm: true })
    })
  })
})
