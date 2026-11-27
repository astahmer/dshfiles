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
import { ProjectLocator } from './project-locator.js'
import { AgentsRegistry } from './store.js'
import { SubagentAgentsProviderLayer } from './subagent-agents-promise.js'
import { ToolAccessProviderLayer } from './tool-access-provider.js'

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
/** One project checkout, one of its thread workspaces, and an unrelated folder. */
const workspaces = [
  { workspaceId: 'ws-app', path: '/dev/app', sessionIds: ['in-app'] },
  { workspaceId: 'ws-app-thread', path: '/dev/app-threads/thread-1a2b3c', sessionIds: ['in-thread-workspace'] },
  { workspaceId: 'ws-other', path: '/dev/other', sessionIds: [] },
]

const openRegistry = Effect.map(
  Layer.build(AgentsRegistry.layer.pipe(Layer.provide(Layer.merge(StorageDomain.layer, ProjectLocator.layerTest(workspaces))))),
  services => Context.get(services, AgentsRegistry),
)

/** The registry writes a decision in the background; give that write time to land before a restart. */
const settle = Effect.promise(() => new Promise(resolve => setTimeout(resolve, 50)))

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
  tools: { tools: {}, groups: {} },
  subagents: { allowed: 'any', default: null },
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
    it.effect(
      'refuses past the agent limit without dropping existing rows',
      () =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* TestClock.setTime(4_000)
            const registry = yield* openRegistry
            for (let index = 0; index < 99; index += 1) yield* registry.save(draftOf(`agent-${String(index)}`))
            expect((yield* registry.save(draftOf('one-more'))).kind).toBe('limit')
            expect((yield* registry.resolve('agent-98'))?.handle).toBe('agent-98')
          }),
        ),
      // Every save is a durable write, up to the limit of them, which runs past five seconds on a loaded machine.
      30_000,
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
            expect(yield* restored.threadHandles).toEqual([{ sessionId: 'session-a', handle: 'reviewer' }])
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

  it.layer(storageHost)(it => {
    it.effect('decides a thread agent in order: explicit, inherited by a subagent, project default (thread workspaces too), then @dsh', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(10_000)
          const registry = yield* openRegistry
          yield* registry.save(draftOf('reviewer'))
          yield* registry.save(draftOf('planner'))
          yield* registry.recordUse('reviewer', { sessionId: 'dispatched', title: 'Review' })
          expect((yield* registry.setProjectDefault('ws-app', 'planner')).kind).toBe('applied')

          const policy = (sessionId: string, extra: { readonly cwd?: string; readonly parentSessionId?: string } = {}) =>
            registry.threadPolicyNow({ sessionId, cwd: extra.cwd, parentSessionId: extra.parentSessionId })

          expect(policy('dispatched', { cwd: '/dev/app' })).toMatchObject({ agent: 'reviewer', source: 'agent' })
          expect(policy('child', { cwd: '/dev/app', parentSessionId: 'dispatched' })).toMatchObject({ agent: 'reviewer', source: 'agent' })
          expect((yield* registry.threadAccess({ sessionId: 'child' })).agent).toMatchObject({ resolution: 'inherited', inheritedFrom: 'dispatched' })
          expect(policy('in-app')).toMatchObject({ agent: 'planner', source: 'project-default' })
          expect(policy('in-thread-workspace')).toMatchObject({ agent: 'planner', source: 'project-default' })
          expect(policy('forgotten-thread-workspace', { cwd: '/dev/app-threads/thread-9z8y7x' })).toMatchObject({ agent: 'planner', source: 'project-default' })
          expect(policy('elsewhere', { cwd: '/dev/other' })).toMatchObject({ agent: 'dsh', source: 'default' })
          expect(policy('nowhere')).toMatchObject({ agent: 'dsh', source: 'default' })
          expect(policy('orphan-child', { cwd: '/dev/other', parentSessionId: 'never-seen' })).toMatchObject({ agent: 'dsh', source: 'default' })
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('keeps a decided thread on its agent and tools when the project default or the agent changes, across a restart', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(11_000)
        yield* Effect.scoped(
          Effect.gen(function* () {
            const registry = yield* openRegistry
            yield* registry.save(draftOf('planner'))
            yield* registry.save(draftOf('reviewer'))
            yield* registry.setProjectDefault('ws-app', 'planner')
            expect(registry.threadPolicyNow({ sessionId: 'early', cwd: '/dev/app', parentSessionId: undefined }).agent).toBe('planner')

            yield* registry.setProjectDefault('ws-app', 'reviewer')
            yield* registry.editToolAccess('planner', [{ target: { kind: 'tool', key: 'bash' }, entry: { enabled: false } }])
            expect(registry.threadPolicyNow({ sessionId: 'early', cwd: '/dev/app', parentSessionId: undefined })).toMatchObject({
              agent: 'planner',
              access: { tools: {}, groups: {} },
            })
            expect(registry.threadPolicyNow({ sessionId: 'late', cwd: '/dev/app', parentSessionId: undefined }).agent).toBe('reviewer')
            yield* settle
          }),
        )
        const restored = yield* Effect.scoped(openRegistry)
        expect(restored.threadPolicyNow({ sessionId: 'early', cwd: '/dev/app', parentSessionId: undefined }).agent).toBe('planner')
        expect((yield* restored.projectDefaults).map(row => [row.projectId, row.handle])).toEqual([['ws-app', 'reviewer']])
        expect((yield* restored.resolve('planner'))?.tools).toEqual({ tools: { bash: { enabled: false } }, groups: {} })
      }),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('sets, reports and clears a thread override, and refuses an unknown agent', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(12_000)
          const registry = yield* openRegistry
          yield* registry.save({ ...draftOf('locked'), tools: { tools: {}, groups: { native: { enabled: false } } } })
          yield* registry.save({ ...draftOf('pinned'), tools: { tools: { read: { pinned: true } }, groups: {} } })
          yield* registry.setProjectDefault('ws-app', 'locked')
          const changed: string[] = []
          const unsubscribe = registry.subscribe(sessionId => changed.push(sessionId))
          const subject = { sessionId: 'in-app', cwd: '/dev/app', parentSessionId: undefined }
          expect(registry.threadPolicyNow(subject)).toMatchObject({ source: 'project-default', access: { groups: { native: { enabled: false } } } })

          const all = yield* registry.setThreadOverride('in-app', { kind: 'all' })
          expect(all.kind).toBe('applied')
          expect(registry.threadPolicyNow(subject)).toMatchObject({ agent: 'locked', source: 'override', toolsFrom: null, access: { tools: {}, groups: {} } })
          yield* registry.setThreadOverride('in-app', { kind: 'agent', handle: 'pinned' })
          expect(registry.threadPolicyNow(subject)).toMatchObject({ source: 'override', toolsFrom: 'pinned', access: { tools: { read: { pinned: true } } } })
          expect((yield* registry.setThreadOverride('in-app', { kind: 'agent', handle: 'ghost' })).kind).toBe('missing-agent')
          yield* registry.setThreadOverride('in-app', null)
          expect(registry.threadPolicyNow(subject)).toMatchObject({ agent: 'locked', source: 'project-default', toolsFrom: 'locked' })
          expect(changed).toEqual(['in-app', 'in-app', 'in-app'])
          unsubscribe()
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('makes a dispatch recorded after the thread attached its explicit agent and reports the change', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(13_000)
          const registry = yield* openRegistry
          yield* registry.save(draftOf('reviewer'))
          const changed: string[] = []
          registry.subscribe(sessionId => changed.push(sessionId))
          expect(registry.threadPolicyNow({ sessionId: 'race', cwd: undefined, parentSessionId: undefined }).agent).toBe('dsh')
          yield* registry.recordUse('reviewer', { sessionId: 'race', title: 'Review' })
          expect(registry.threadPolicyNow({ sessionId: 'race', cwd: undefined, parentSessionId: undefined })).toMatchObject({
            agent: 'reviewer',
            source: 'agent',
          })
          expect(changed).toEqual(['race'])
          expect((yield* registry.recordThreadAgent('preset-child', 'reviewer'))?.agent.resolution).toBe('explicit')
          expect(yield* registry.recordThreadAgent('preset-child', 'ghost')).toBeNull()
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('edits tool access entry by entry and reverses an edit, and stores subagent choices', () =>
      Effect.scoped(
        Effect.gen(function* () {
          yield* TestClock.setTime(14_000)
          const registry = yield* openRegistry
          yield* registry.save(draftOf('reviewer'))
          const edited = yield* registry.editToolAccess('reviewer', [
            { target: { kind: 'group', key: 'mcp:github' }, entry: { enabled: false } },
            { target: { kind: 'tool', key: 'mcp__github__list_issues' }, entry: { enabled: true, pinned: true } },
          ])
          if (edited.kind !== 'applied') return expect.fail('the edit should apply')
          expect(edited.agent.tools).toEqual({
            tools: { mcp__github__list_issues: { enabled: true, pinned: true } },
            groups: { 'mcp:github': { enabled: false } },
          })
          const reverted = yield* registry.editToolAccess('reviewer', [{ target: { kind: 'group', key: 'mcp:github' }, entry: null }])
          if (reverted.kind !== 'applied') return expect.fail('the revert should apply')
          expect(reverted.agent.tools.groups).toEqual({})
          expect((yield* registry.editToolAccess('ghost', [{ target: { kind: 'tool', key: 'read' }, entry: null }])).kind).toBe('missing')

          const subagents = yield* registry.setSubagents('reviewer', { allowed: ['planner'], default: 'planner' })
          if (subagents.kind !== 'applied') return expect.fail('the subagents should apply')
          expect(subagents.agent.subagents).toEqual({ allowed: ['planner'], default: 'planner' })
          expect((yield* registry.resolve('dsh'))?.subagents).toEqual({ allowed: 'any', default: null })
        }),
      ),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('provides dshfilesToolAccess on the Host while the plugin lives and withdraws it on unload', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(15_000)
        const host = yield* HostContext
        yield* Effect.scoped(
          Effect.gen(function* () {
            const services = yield* Layer.build(
              ToolAccessProviderLayer.pipe(
                Layer.provideMerge(AgentsRegistry.layer.pipe(Layer.provide(Layer.merge(StorageDomain.layer, ProjectLocator.layerTest(workspaces))))),
              ),
            )
            const registry = Context.get(services, AgentsRegistry)
            yield* registry.save({ ...draftOf('reviewer'), tools: { tools: { bash: { enabled: false } }, groups: {} } })
            yield* registry.setProjectDefault('ws-app', 'reviewer')
            const provider = host.ctx.get('dshfilesToolAccess')
            if (provider === undefined || provider === null) return expect.fail('the provider should be registered')
            const changed: string[] = []
            provider.subscribe(sessionId => changed.push(sessionId))
            expect(provider.resolve({ sessionId: 'in-app', cwd: '/dev/app', parentSessionId: undefined })).toMatchObject({
              agent: 'reviewer',
              source: 'project-default',
              access: { tools: { bash: { enabled: false } } },
            })
            yield* registry.setThreadOverride('in-app', { kind: 'all' })
            expect(changed).toEqual(['in-app'])
          }),
        )
        expect(host.ctx.get('dshfilesToolAccess')).toBeUndefined()
      }),
    )
  })

  it.layer(storageHost)(it => {
    it.effect('provides dshfilesSubagentAgents: a default agent recorded for the child before it attaches, refusals, a listing', () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(16_000)
        const host = yield* HostContext
        yield* Effect.scoped(
          Effect.gen(function* () {
            const services = yield* Layer.build(
              SubagentAgentsProviderLayer.pipe(
                Layer.provideMerge(AgentsRegistry.layer.pipe(Layer.provide(Layer.merge(StorageDomain.layer, ProjectLocator.layerTest(workspaces))))),
              ),
            )
            const registry = Context.get(services, AgentsRegistry)
            const route = { provider: 'beta', model: 'review-model' }
            yield* registry.save({ ...draftOf('reviewer'), route, preset: 'review', instructions: 'Be strict.', tools: { tools: { bash: { enabled: false } }, groups: {} } })
            yield* registry.save({ ...draftOf('ops') })
            yield* registry.save({ ...draftOf('lead'), subagents: { allowed: ['reviewer'], default: 'reviewer' } })
            yield* registry.recordThreadAgent('parent-thread', 'lead')
            const resolver = host.ctx.get('dshfilesSubagentAgents')
            if (resolver === undefined || resolver === null) return expect.fail('the resolver should be registered')
            const parent = { sessionId: 'parent-thread', cwd: undefined, parentSessionId: undefined }

            const choice = resolver.resolve({ parent, handle: undefined })
            if (choice.kind !== 'agent') return expect.fail(`expected the default agent, got ${choice.kind}`)
            expect(choice).toMatchObject({ handle: 'reviewer', route, preset: 'review' })
            expect(choice.preamble).toBe('Work as @reviewer — reviewer.\n\nBe strict.')
            yield* Effect.promise(() => choice.record('child-1'))
            // The child's first tool policy read (tool-search, at attach) already sees @reviewer, not the inherited @lead.
            expect(registry.threadPolicyNow({ sessionId: 'child-1', cwd: undefined, parentSessionId: 'parent-thread' })).toMatchObject({
              agent: 'reviewer',
              source: 'agent',
              access: { tools: { bash: { enabled: false } } },
            })

            const refused = resolver.resolve({ parent, handle: 'ops' })
            expect(refused.kind === 'refused' ? refused.message : '').toContain("@lead's subagents may not run as @ops")
            expect(resolver.list(parent)).toMatchObject({ parent: 'lead', default: 'reviewer', agents: [{ handle: 'lead' }, { handle: 'reviewer' }] })
          }),
        )
        expect(host.ctx.get('dshfilesSubagentAgents')).toBeUndefined()
      }),
    )
  })
})
