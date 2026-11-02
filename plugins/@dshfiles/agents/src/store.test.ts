import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Effect, Layer } from 'effect'
import { TestClock } from 'effect/testing'
import type { AgentDraft } from './agent.js'
import { AgentsRegistry } from './store.js'

/** A real JSON-backed storage domain facility in a temporary directory, as the Host serves it. */
const storageHost = Layer.effect(
  HostContext,
  Effect.gen(function* () {
    const root = yield* Effect.acquireRelease(
      Effect.promise(() => mkdtemp(join(tmpdir(), 'agents-store-'))),
      directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
    )
    const host = yield* Effect.acquireRelease(
      Effect.promise(async () => {
        const created = await createTestHost()
        await created.ctx.plugin(Storage)
        await created.ctx.plugin(StorageJson, { root })
        await created.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
        return created
      }),
      created => Effect.promise(() => created.dispose()),
    )
    return HostContext.of({ ctx: host.ctx, packageId: '@dshfiles/agents' })
  }),
)

/** Open the registry for one scope; closing the scope closes the domain, as a plugin unload does. */
const openRegistry = Effect.map(Layer.build(AgentsRegistry.layer.pipe(Layer.provide(StorageDomain.layer))), services => Context.get(services, AgentsRegistry))

const draftOf = (handle: string): AgentDraft => ({
  handle,
  name: handle,
  glyph: '🤖',
  description: '',
  instructions: '',
  preset: null,
  route: null,
  memoryScope: null,
  routine: '',
  delegation: { messaging: 'any', handles: [], subagents: true },
  enabled: true,
})

const handlesOf = (snapshot: { readonly agents: readonly { readonly handle: string }[] }) => snapshot.agents.map(agent => agent.handle)

describe('AgentsRegistry', () => {
  it.layer(storageHost)(it => {
    it.effect('seeds the built-in agent and keeps it out of deletion', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(1_000)
          const registry = yield* openRegistry
          expect(handlesOf(yield* registry.snapshot)).toEqual(['dsh'])
          expect((yield* registry.remove('dsh')).kind).toBe('built-in')
          expect((yield* registry.resolve('dsh'))?.builtIn).toBe(true)
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('saves a new agent with usage metadata and keeps it on update', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(2_000)
          const registry = yield* openRegistry
          const saved = yield* registry.save(draftOf('reviewer'))
          if (saved.kind !== 'applied') return expect.fail('the first agent should be saved')
          expect(saved.agent).toMatchObject({ createdAt: 2_000, threadCount: 0, builtIn: false })

          const used = yield* registry.recordUse('reviewer')
          expect(used.revision).toBeGreaterThan(saved.revision)

          const edited = yield* registry.save({ ...draftOf('reviewer'), name: 'Review Bot' })
          if (edited.kind !== 'applied') return expect.fail('the edit should be saved')
          expect(edited.agent).toMatchObject({ name: 'Review Bot', threadCount: 1, createdAt: 2_000 })
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('removes a custom agent durably and reports a missing one', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(3_000)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* openRegistry
            yield* registry.save(draftOf('reviewer'))
            yield* registry.save(draftOf('planner'))
            expect((yield* registry.remove('reviewer')).kind).toBe('applied')
            expect((yield* registry.remove('reviewer')).kind).toBe('missing')
          }),
        )
        const reopened = yield* Effect.scoped(Effect.flatMap(openRegistry, registry => registry.snapshot))
        expect(handlesOf(reopened)).toEqual(expect.arrayContaining(['dsh', 'planner']))
        expect(handlesOf(reopened)).not.toContain('reviewer')
      }),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('refuses past the agent limit without dropping existing rows', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(4_000)
          const registry = yield* openRegistry
          for (let index = 0; index < 99; index += 1) yield* registry.save(draftOf(`agent-${String(index)}`))
          expect((yield* registry.save(draftOf('one-more'))).kind).toBe('limit')
          expect((yield* registry.resolve('agent-98'))?.handle).toBe('agent-98')
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('keeps a dispatched thread and its usage across a restart', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(6_000)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* openRegistry
            yield* registry.save(draftOf('reviewer'))
            const used = yield* registry.recordUse('reviewer', { sessionId: 'session-a', title: 'Review the pull request' })
            expect(used.agents.find(agent => agent.handle === 'reviewer')?.threadCount).toBe(1)
            // The same dispatch retried is idempotent: one row, one count, one last-used time.
            yield* registry.recordUse('reviewer', { sessionId: 'session-a', title: 'Review the pull request' })
          }),
        )
        yield* Effect.scoped(
          Effect.gen(function* () {
            const restored = yield* openRegistry
            expect(yield* restored.resolve('reviewer')).toMatchObject({ threadCount: 1, lastUsedAt: 6_000 })
            expect((yield* restored.threads('reviewer')).map(thread => thread.sessionId)).toEqual(['session-a'])
            expect((yield* restored.threadAgent('session-a'))?.handle).toBe('reviewer')
            expect(restored.threadAgentNow('session-a')?.handle).toBe('reviewer')
            expect(yield* restored.threadAgent('session-b')).toBeNull()
          }),
        )
      }),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('lists an agent’s threads newest first and drops one when the agent goes', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(7_000)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* openRegistry
            yield* registry.save(draftOf('reviewer'))
            yield* registry.save(draftOf('planner'))
            yield* registry.recordUse('reviewer', { sessionId: 'session-old', title: 'Older' })
            yield* TestClock.setTime(8_000)
            yield* registry.recordUse('reviewer', { sessionId: 'session-new', title: 'Newer' })
            yield* registry.recordUse('planner', { sessionId: 'session-plan', title: 'Plan' })
            expect((yield* registry.threads('reviewer')).map(thread => thread.title)).toEqual(['Newer', 'Older'])
            expect((yield* registry.threads('planner')).map(thread => thread.title)).toEqual(['Plan'])
            yield* registry.remove('reviewer')
            expect(yield* registry.threadAgent('session-old')).toBeNull()
          }),
        )
        const restored = yield* Effect.scoped(openRegistry)
        expect(restored.threadAgentNow('session-old')).toBeNull()
        expect(restored.threadAgentNow('session-plan')?.handle).toBe('planner')
      }),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('advances the revision on a write with an unchanged clock and never starts below a stored edit', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(5_000)
        const saved = yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* openRegistry
            const first = (yield* registry.snapshot).revision
            const result = yield* registry.save(draftOf('reviewer'))
            expect(result.revision).toBeGreaterThan(first)
            return result
          }),
        )
        yield* TestClock.setTime(1_000)
        const reopened = yield* Effect.scoped(Effect.flatMap(openRegistry, registry => registry.snapshot))
        expect(reopened.revision).toBeGreaterThanOrEqual(saved.kind === 'applied' ? saved.agent.updatedAt : 0)
      }),
    )
  })
})
