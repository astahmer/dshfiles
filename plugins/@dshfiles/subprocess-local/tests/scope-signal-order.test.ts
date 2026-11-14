import { afterEach, expect, it, vi } from 'vitest'
import { prepareLinuxTerminalScope, type LinuxScopeInternals } from '../src/native/linux-scope.ts'

type SystemctlQuery = NonNullable<LinuxScopeInternals['systemctlQuery']>
type QueryResult = Awaited<ReturnType<SystemctlQuery>>

const ok = (stdout = ''): QueryResult => ({ status: 0, stdout, stderr: '' })
const UNIT_GONE = ok('LoadState=not-found\nActiveState=inactive\n')

const cleanups: (() => void)[] = []
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup()
})

/** A scope owner whose manager answers through `query`; any synchronous manager call is recorded. */
function scopeOwner(query: SystemctlQuery) {
  const syncCalls: (readonly unknown[])[] = []
  const spawnSync = (...call: readonly unknown[]) => {
    syncCalls.push(call)
    return { status: 0, stdout: '', stderr: '' }
  }
  const launch = prepareLinuxTerminalScope({ argv: ['true'], cwd: process.cwd(), rows: 24, cols: 80, terminalType: 'xterm', graceMs: 10 }, {}, [], {
    runnerInvocation: [process.execPath],
    systemctlQuery: query,
    spawnSync: spawnSync as never,
  })
  cleanups.push(launch.cleanup)
  const owner = launch.bindOwner({ running: () => false, signal: () => true, settled: Promise.resolve() })
  return { owner, syncCalls }
}

const describeCall = (args: readonly string[]): string => (args.includes('kill') ? args.find(arg => arg.startsWith('--signal='))! : args[1]!)

it('signals the manager without blocking the Host on a synchronous fork', async () => {
  const { owner, syncCalls } = scopeOwner(async (_command, args) => (args.includes('show') ? UNIT_GONE : ok()))
  owner.signal('SIGTERM')
  owner.signal('SIGKILL')
  await owner.waitForExit()
  expect(syncCalls).toEqual([])
})

it('delivers TERM before KILL and joins both before declaring the range gone', async () => {
  const term = Promise.withResolvers<QueryResult>()
  const calls: string[] = []
  const { owner } = scopeOwner(async (_command, args) => {
    calls.push(describeCall(args))
    if (args.includes('--signal=SIGTERM')) return term.promise
    return args.includes('show') ? UNIT_GONE : ok()
  })
  owner.signal('SIGTERM')
  owner.signal('SIGKILL')
  let exited = false
  const exit = owner.waitForExit().then(() => {
    exited = true
  })

  await vi.waitFor(() => {
    expect(calls).toEqual(['--signal=SIGTERM'])
  })
  await new Promise(resolve => setTimeout(resolve, 20))
  // KILL waits for the manager's answer to TERM; observation waits for both.
  expect(calls).toEqual(['--signal=SIGTERM'])
  expect(exited).toBe(false)

  term.resolve(ok())
  await exit
  expect(calls).toEqual(['--signal=SIGTERM', '--signal=SIGKILL', 'show'])
})

it('reports a refused KILL while the managed range stays active', async () => {
  const { owner } = scopeOwner(async (_command, args) =>
    args.includes('kill') ? { status: 1, stdout: '', stderr: 'manager refused signal' } : ok('LoadState=loaded\nActiveState=active\nTasksCurrent=2\n'),
  )
  owner.signal('SIGKILL')
  await expect(owner.waitForExit()).rejects.toThrow('manager refused signal')
})

it('keeps the synchronous KILL for Host exit, when nothing can be awaited', () => {
  const { owner, syncCalls } = scopeOwner(async () => ok())
  owner.terminateForHostExit()
  expect(syncCalls).toEqual([[expect.any(String), expect.arrayContaining(['kill', '--kill-who=all', '--signal=SIGKILL']), expect.any(Object)]])
})
