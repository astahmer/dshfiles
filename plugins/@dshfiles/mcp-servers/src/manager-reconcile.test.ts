import { describe, expect, it } from '@effect/vitest'
import { Context, type Duration, Effect, Fiber, Layer, Option, Ref, Stream } from 'effect'
import type { StoredServer } from './api.js'
import type { ManagerConfig } from './config.js'
import { McpHost } from './host-promise.js'
import { LocalCommands } from './local-process.js'
import { McpManager } from './manager.js'
import { McpOAuth } from './oauth-promise.js'
import { PendingAuthorizations } from './pending-authorizations.js'
import { RegistrySearch } from './registry-search.js'

// The manager over a stand-in Host that counts credential reads, client starts and stops; nothing reaches DSH.

interface Counters {
  readonly resolves: number
  readonly described: number
  readonly attaches: number
  readonly detaches: number
  readonly maxRunning: number
  readonly running: number
}

const stdio = (index: number, enabled: boolean): StoredServer => ({
  id: `server-${String(index)}`,
  name: `Server ${String(index)}`,
  serverName: `s${String(index)}`,
  enabled,
  transport: 'stdio',
  command: 'synthetic-mcp',
  args: [],
  cwd: '/tmp',
  envRefs: { SHARED: 'SHARED_TOKEN', OWN: `TOKEN_${String(index % 4)}` },
})

const sixtyFour = Array.from({ length: 64 }, (_, index) => stdio(index, index % 4 !== 0))

const harness = (config: ManagerConfig, input: { readonly attachDelay?: Duration.Input } = {}) =>
  Effect.gen(function* () {
    const counters = yield* Ref.make<Counters>({ resolves: 0, described: 0, attaches: 0, detaches: 0, maxRunning: 0, running: 0 })
    const count = (change: (current: Counters) => Counters) => Ref.update(counters, change)
    const host = McpHost.of({
      config: Effect.succeed(config),
      rawConfig: Effect.succeed(config),
      editConfig: () => Effect.void,
      configUpdates: Stream.empty,
      readGrant: () => Effect.succeedNone,
      modifyGrant: () => Effect.succeedNone,
      writeGrant: () => Effect.void,
      deleteGrant: () => Effect.void,
      isConfigured: () =>
        Effect.as(
          count(current => ({ ...current, described: current.described + 1 })),
          true,
        ),
      resolveReference: reference =>
        Effect.as(
          count(current => ({ ...current, resolves: current.resolves + 1 })),
          Option.some(`value-of-${reference}`),
        ),
      toolNames: Effect.succeed(sixtyFour.flatMap(server => [`mcp__${server.serverName}__a`, `mcp__${server.serverName}__b`])),
      warn: () => Effect.void,
      attachClient: () =>
        Effect.acquireRelease(
          Effect.gen(function* () {
            if (input.attachDelay !== undefined) yield* Effect.sleep(input.attachDelay)
            yield* count(current => {
              const running = current.running + 1
              return { ...current, attaches: current.attaches + 1, running, maxRunning: Math.max(current.maxRunning, running) }
            })
          }),
          () => count(current => ({ ...current, detaches: current.detaches + 1, running: current.running - 1 })),
        ).pipe(Effect.asVoid),
      serveRoute: () => Effect.void,
      showSettingsPage: Effect.void,
      referenceUpdates: Stream.empty,
    })
    const oauth = McpOAuth.of({
      discover: () => Effect.die('unused'),
      registerClient: () => Effect.die('unused'),
      authorizationStart: Effect.die('unused'),
      exchangeCode: () => Effect.die('unused'),
      refresh: grant => Effect.succeedSome(grant),
      needsRefresh: () => Effect.succeed(false),
    })
    const layer = McpManager.layer(config).pipe(
      Layer.provide(
        Layer.mergeAll(
          Layer.succeed(McpHost, host),
          Layer.succeed(McpOAuth, oauth),
          Layer.succeed(LocalCommands, LocalCommands.of({ start: () => Effect.die('unused') })),
          Layer.succeed(RegistrySearch, RegistrySearch.of({ search: () => Effect.succeed([]) })),
          PendingAuthorizations.layer,
        ),
      ),
    )
    const manager = Context.get(yield* Layer.build(layer), McpManager)
    return {
      manager,
      counters: Ref.get(counters),
      reset: Ref.update(counters, current => ({ ...current, resolves: 0, described: 0, attaches: 0, detaches: 0 })),
    }
  })

describe('MCP manager reconciliation work (H17)', () => {
  it.live('reads each active reference once and coalesces a credential storm into one restart pass', () =>
    Effect.gen(function* () {
      const { manager, counters, reset } = yield* harness({ servers: sixtyFour }, { attachDelay: '1 millis' })
      yield* manager.reconcile()
      // 48 enabled servers share 5 references; the 16 disabled ones get no credential work at all.
      expect(yield* counters).toMatchObject({ resolves: 4, attaches: 48, running: 48 })
      yield* reset
      const storm = yield* Effect.forEach(
        Array.from({ length: 20 }, () => manager.referenceUpdated('SHARED_TOKEN')),
        update => Effect.forkChild(update, { startImmediately: true }),
      )
      yield* Fiber.joinAll(storm)
      // Before coalescing the same storm read 2,560 references and restarted 960 clients (16.6 s).
      const afterStorm = yield* counters
      expect(afterStorm.resolves).toBeLessThanOrEqual(8)
      expect(afterStorm.attaches).toBeLessThanOrEqual(96)
      expect(afterStorm.detaches).toBe(afterStorm.attaches)
      expect(afterStorm.running).toBe(48)
      yield* reset
      yield* manager.snapshot
      expect((yield* counters).described).toBe(5)
    }).pipe(Effect.scoped),
  )

  it.live(
    'applies the newest server list when calls overlap a running pass, and an aborted caller cancels nothing',
    () =>
      Effect.gen(function* () {
        const { manager, counters } = yield* harness({ servers: sixtyFour.slice(0, 8) }, { attachDelay: '5 millis' })
        const first = yield* Effect.forkChild(manager.reconcile({ servers: sixtyFour.slice(0, 8) }), { startImmediately: true })
        yield* Effect.sleep('2 millis')
        const aborted = yield* Effect.forkChild(manager.reconcile({ servers: sixtyFour.slice(0, 4) }), { startImmediately: true })
        const newest = yield* Effect.forkChild(manager.reconcile({ servers: sixtyFour.slice(0, 2) }), { startImmediately: true })
        yield* Fiber.interrupt(aborted)
        yield* Fiber.join(first)
        yield* Fiber.join(newest)
        // servers 0..1: server 0 is disabled, so exactly one client runs from the newest list.
        expect((yield* counters).running).toBe(1)
      }).pipe(Effect.scoped),
    30_000,
  )
})
