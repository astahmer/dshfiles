import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import LocalSubprocessRuntime from '@deepseek-ai/dsh-subprocess-local'
import { HostContext } from '@dshfiles/dshx/effect'
import { DshChildProcessSpawner } from '@dshfiles/dshx/effect/child-process-spawner'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Context, Deferred, Effect, Exit, Fiber, Layer, Ref, Schedule, Scope } from 'effect'
import { McpExecutables } from './host-promise.js'
import { LocalCommands } from './local-process.js'
import { makeClientReconciler, type ClientTarget, type ReconcilePlan } from './reconcile.js'

// MCP client lifecycle: one child Scope per running client, every transition serialized under one Semaphore, and
// local start commands on the real subprocess runtime with their whole process group stopped with their Scope.

const target = (id: string, fingerprint: string, extra: Partial<ClientTarget> = {}): ClientTarget => ({ id, enabled: true, ready: true, fingerprint, ...extra })

const plan = (targets: ReadonlyArray<ClientTarget>): ReconcilePlan<ClientTarget> => ({ targets, restart: new Set() })

/** A reconciler whose clients record their start and stop; `stopGate` holds every stop until it opens. */
const recordingReconciler = (input: { readonly stopGate?: Deferred.Deferred<void>; readonly failing?: ReadonlySet<string> } = {}) =>
  Effect.gen(function* () {
    const events = yield* Ref.make<ReadonlyArray<string>>([])
    const record = (event: string) => Ref.update(events, list => [...list, event])
    const reconciler = yield* makeClientReconciler((next: ClientTarget) =>
      Effect.gen(function* () {
        yield* record(`start ${next.id}:${next.fingerprint}`)
        if (input.failing?.has(next.fingerprint) === true) return yield* Effect.fail('start failed')
        yield* Effect.addFinalizer(() =>
          Effect.gen(function* () {
            yield* record(`stop-begin ${next.id}:${next.fingerprint}`)
            if (input.stopGate !== undefined) yield* Deferred.await(input.stopGate)
            yield* record(`stop-end ${next.id}:${next.fingerprint}`)
          }),
        )
      }),
    )
    return { reconciler, events: Ref.get(events) }
  })

const eventually = <A>(read: Effect.Effect<A>, accept: (value: A) => boolean) =>
  read.pipe(Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: accept }), Effect.timeout('5 seconds'))

describe('client reconciler ordering', () => {
  it.live('applies update, reconcile and restart calls strictly in call order, whatever their own latency', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      const slowPlan = yield* Deferred.make<void>()
      const calls = [
        reconciler.update([target('one', 'a')]),
        reconciler.reconcile(Deferred.await(slowPlan).pipe(Effect.as(plan([target('one', 'b')])))),
        reconciler.update([target('one', 'c')]),
        reconciler.restart('one', [target('one', 'c')]),
      ]
      const fibers: Array<Fiber.Fiber<void>> = []
      for (const call of calls) {
        fibers.push(yield* Effect.forkChild(call))
        yield* Effect.yieldNow
      }
      yield* Deferred.succeed(slowPlan, undefined)
      yield* Fiber.joinAll(fibers)
      expect(yield* events).toEqual([
        'start one:a',
        'stop-begin one:a',
        'stop-end one:a',
        'start one:b',
        'stop-begin one:b',
        'stop-end one:b',
        'start one:c',
        'stop-begin one:c',
        'stop-end one:c',
        'start one:c',
      ])
      expect(yield* reconciler.state('one')).toBe('loaded')
    }).pipe(Effect.scoped),
  )

  it.live('applies the newest plan when an older plan resolves its targets later', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      const releaseOlder = yield* Deferred.make<void>()
      const older = yield* Effect.forkChild(reconciler.reconcile(Deferred.await(releaseOlder).pipe(Effect.as(plan([target('one', 'older')])))))
      yield* Effect.yieldNow
      const newer = yield* Effect.forkChild(reconciler.reconcile(Effect.succeed(plan([target('one', 'newer')]))))
      yield* Effect.yieldNow
      yield* Deferred.succeed(releaseOlder, undefined)
      yield* Fiber.joinAll([older, newer])
      expect((yield* events).at(-1)).toBe('start one:newer')
    }).pipe(Effect.scoped),
  )

  it.live('a replacement starts only after the previous client finished stopping', () =>
    Effect.gen(function* () {
      const stop = yield* Deferred.make<void>()
      const { reconciler, events } = yield* recordingReconciler({ stopGate: stop })
      yield* reconciler.update([target('one', 'a')])
      const replacing = yield* Effect.forkChild(reconciler.update([target('one', 'b')]))
      yield* eventually(events, list => list.length === 2)
      expect(yield* events).toEqual(['start one:a', 'stop-begin one:a'])
      yield* Deferred.succeed(stop, undefined)
      yield* Fiber.join(replacing)
      expect(yield* events).toEqual(['start one:a', 'stop-begin one:a', 'stop-end one:a', 'start one:b'])
    }).pipe(Effect.scoped),
  )

  it.effect('a plan that fails fails its own call and leaves the queue running', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      const failed = yield* Effect.flip(reconciler.reconcile(Effect.fail('credential resolution failed')))
      expect(failed).toBe('credential resolution failed')
      yield* reconciler.update([target('one', 'a')])
      expect(yield* events).toEqual(['start one:a'])
    }).pipe(Effect.scoped),
  )

  it.effect('a failed start is retried by every later update until it succeeds, without exposing its error', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler({ failing: new Set(['bad']) })
      yield* reconciler.update([target('one', 'bad')])
      expect(yield* reconciler.state('one')).toBe('start-failed')
      yield* reconciler.update([target('one', 'bad')])
      expect(yield* reconciler.state('one')).toBe('start-failed')
      yield* reconciler.update([target('one', 'good')])
      expect(yield* reconciler.state('one')).toBe('loaded')
      expect(yield* events).toEqual(['start one:bad', 'start one:bad', 'start one:good'])
    }).pipe(Effect.scoped),
  )

  it.effect('starts once, replaces edits, stops disabled servers, and removes deleted servers', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      yield* reconciler.update([target('one', 'a')])
      yield* reconciler.update([target('one', 'a')])
      yield* reconciler.update([target('one', 'b')])
      yield* reconciler.update([target('one', 'b', { enabled: false })])
      yield* reconciler.update([])
      expect(yield* events).toEqual(['start one:a', 'stop-begin one:a', 'stop-end one:a', 'start one:b', 'stop-begin one:b', 'stop-end one:b'])
    }).pipe(Effect.scoped),
  )

  it.effect('tracks a manual disconnect separately and reconnects by restarting the client', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      const configured = target('one', 'ref-only-config')
      yield* reconciler.update([configured])
      expect(yield* reconciler.state('one')).toBe('loaded')
      yield* reconciler.update([{ ...configured, suspended: true }])
      expect(yield* reconciler.state('one')).toBe('manually-disconnected')
      yield* reconciler.restart('one', [configured])
      expect(yield* reconciler.state('one')).toBe('loaded')
      yield* reconciler.update([{ ...configured, enabled: false }])
      expect(yield* reconciler.state('one')).toBe('inactive')
      expect((yield* events).filter(event => event.startsWith('start'))).toHaveLength(2)
    }).pipe(Effect.scoped),
  )

  it.effect('servers start and stop independently, and closing the scope stops every active client', () =>
    Effect.gen(function* () {
      const scope = yield* Scope.make()
      const { reconciler, events } = yield* recordingReconciler().pipe(Scope.provide(scope))
      yield* reconciler.update([target('one', 'a'), target('two', 'a'), target('three', 'a', { ready: false })])
      const states = yield* Effect.forEach(['one', 'two', 'three'], id => reconciler.state(id))
      expect(states).toEqual(['loaded', 'loaded', 'inactive'])
      yield* reconciler.update([target('one', 'a'), target('three', 'a', { ready: false })])
      expect(yield* reconciler.state('two')).toBe('inactive')
      yield* Scope.close(scope, Exit.void)
      expect(yield* events).toEqual(['start one:a', 'start two:a', 'stop-begin two:a', 'stop-end two:a', 'stop-begin one:a', 'stop-end one:a'])
    }),
  )

  it.effect('restarting a server the targets no longer want just stops it', () =>
    Effect.gen(function* () {
      const { reconciler, events } = yield* recordingReconciler()
      yield* reconciler.update([target('one', 'a')])
      yield* reconciler.restart('one', [target('one', 'a', { enabled: false })])
      expect(yield* events).toEqual(['start one:a', 'stop-begin one:a', 'stop-end one:a'])
      expect(yield* reconciler.state('one')).toBe('inactive')
    }).pipe(Effect.scoped),
  )
})

const localCommands = Effect.gen(function* () {
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  yield* Effect.promise(() => host.ctx.plugin(LocalSubprocessRuntime))
  const services = yield* Layer.build(
    LocalCommands.layer.pipe(
      Layer.provide(Layer.mergeAll(DshChildProcessSpawner.layer, McpExecutables.layer)),
      Layer.provide(HostContext.layer({ ctx: host.ctx, packageId: '@dshfiles/mcp-servers' })),
    ),
  )
  return Context.get(services, LocalCommands)
})

const scratch = Effect.acquireRelease(
  Effect.promise(() => mkdtemp(join(tmpdir(), 'mcp-servers-local-'))),
  directory => Effect.promise(() => rm(directory, { recursive: true, force: true })),
)

const readPid = (path: string) =>
  Effect.promise(() =>
    readFile(path, 'utf8').then(
      text => Number(text.trim()),
      () => 0,
    ),
  )

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

describe('managed local start command on the real subprocess runtime', () => {
  it.live(
    'starts, runs, and stops its whole process group when its scope closes',
    () =>
      Effect.gen(function* () {
        const commands = yield* localCommands
        const directory = yield* scratch
        const pidFile = join(directory, 'child.pid')
        const scope = yield* Scope.make()
        const local = yield* commands
          .start({ id: 'one', command: { command: 'sh', args: ['-c', `sleep 30 & echo $! > '${pidFile}'; wait`], cwd: directory }, env: {} })
          .pipe(Scope.provide(scope))
        expect(yield* local.status).toBe('starting')
        yield* local.markRunning
        expect(yield* local.status).toBe('running')
        const pid = yield* eventually(readPid(pidFile), value => value > 0)
        expect(isAlive(pid)).toBe(true)
        yield* Scope.close(scope, Exit.void)
        expect(yield* local.status).toBe('stopped')
        expect(isAlive(pid)).toBe(false)
      }).pipe(Effect.scoped),
    20_000,
  )

  it.live('runs in the requested directory with the resolved environment references', () =>
    Effect.gen(function* () {
      const commands = yield* localCommands
      const directory = yield* scratch
      const local = yield* commands.start({
        id: 'one',
        command: { command: 'sh', args: ['-c', 'pwd > where.txt; printf %s "$MCP_TOKEN" > token.txt'], cwd: directory },
        env: { MCP_TOKEN: 'resolved-token' },
      })
      yield* eventually(local.status, status => status === 'exited')
      expect((yield* Effect.promise(() => readFile(join(directory, 'where.txt'), 'utf8'))).trim()).toMatch(/mcp-servers-local-/)
      expect(yield* Effect.promise(() => readFile(join(directory, 'token.txt'), 'utf8'))).toBe('resolved-token')
    }).pipe(Effect.scoped),
  )

  it.live('an early exit is reported as exited, survives markRunning, and closing the scope confirms stopped', () =>
    Effect.gen(function* () {
      const commands = yield* localCommands
      const directory = yield* scratch
      const scope = yield* Scope.make()
      const local = yield* commands.start({ id: 'one', command: { command: 'sh', args: ['-c', 'exit 3'], cwd: directory }, env: {} }).pipe(Scope.provide(scope))
      yield* eventually(local.status, status => status === 'exited')
      yield* local.markRunning
      expect(yield* local.status).toBe('exited')
      yield* Scope.close(scope, Exit.void)
      expect(yield* local.status).toBe('stopped')
    }).pipe(Effect.scoped),
  )

  it.live('an executable that does not resolve fails the start with LocalStartFailed', () =>
    Effect.gen(function* () {
      const commands = yield* localCommands
      const directory = yield* scratch
      const error = yield* Effect.flip(commands.start({ id: 'one', command: { command: 'definitely-not-an-mcp-command', args: [], cwd: directory }, env: {} }))
      expect(error._tag).toBe('LocalStartFailed')
    }).pipe(Effect.scoped),
  )
})
