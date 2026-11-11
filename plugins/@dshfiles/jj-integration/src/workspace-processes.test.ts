import { spawn, type ChildProcess } from 'node:child_process'
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { WorkspaceProcesses, WorkspaceProcessModel, type ProcessEntry } from './workspace-processes.js'

const entry = (overrides: Partial<ProcessEntry> & Pick<ProcessEntry, 'pid'>): ProcessEntry => ({
  ppid: 1,
  cwd: '/threads/thread-1',
  command: '/usr/bin/node',
  terminal: false,
  ...overrides,
})

const inside = (table: readonly ProcessEntry[], overrides: { readonly workspacePath?: string; readonly hostCwd?: string } = {}) =>
  WorkspaceProcessModel.inside({
    table,
    workspacePath: overrides.workspacePath ?? '/threads/thread-1',
    hostPid: 100,
    hostCwd: overrides.hostCwd ?? '/repo',
    separator: '/',
  }).map(found => found.pid)

describe('WorkspaceProcessModel', () => {
  it('selects processes at or below the workspace folder, never a sibling sharing its prefix', () => {
    const table = [
      entry({ pid: 10 }),
      entry({ pid: 11, cwd: '/threads/thread-1/web' }),
      entry({ pid: 12, cwd: '/threads/thread-10' }),
      entry({ pid: 13, cwd: '/repo' }),
    ]
    expect(inside(table)).toEqual([10, 11])
  })

  it('never selects the Host or a process it runs under, even inside the workspace', () => {
    const table = [entry({ pid: 100, ppid: 90 }), entry({ pid: 90, ppid: 80 }), entry({ pid: 80, ppid: 1 }), entry({ pid: 101, ppid: 100 })]
    expect(inside(table)).toEqual([101])
  })

  it('selects nothing when the Host itself works inside the workspace, or the path is not an absolute folder', () => {
    const table = [entry({ pid: 10 })]
    expect(inside(table, { hostCwd: '/threads/thread-1/sub' })).toEqual([])
    expect(inside(table, { workspacePath: 'threads/thread-1' })).toEqual([])
    expect(inside([entry({ pid: 10, cwd: '/' })], { workspacePath: '/' })).toEqual([])
  })

  it('previews a terminal as kept and everything else as would-stop, with the command name only', () => {
    expect(WorkspaceProcessModel.preview([entry({ pid: 10, command: '/opt/bin/vite' }), entry({ pid: 11, command: '-zsh', terminal: true })])).toEqual([
      { pid: 10, command: 'vite', outcome: 'would-stop' },
      { pid: 11, command: '-zsh', outcome: 'kept-terminal' },
    ])
  })

  it('joins ps and lsof output by pid', () => {
    const ps = ['  10     1 ??       /usr/bin/node server.js', '  11    10 ttys003  -zsh', '  12     1 ??       /usr/bin/orphan'].join('\n')
    const lsof = ['p10', 'fcwd', 'n/threads/thread-1', 'p11', 'fcwd', 'n/threads/thread-1/web'].join('\n')
    expect(WorkspaceProcessModel.parseDarwin({ ps, lsof })).toEqual([
      { pid: 10, ppid: 1, cwd: '/threads/thread-1', command: '/usr/bin/node server.js', terminal: false },
      { pid: 11, ppid: 10, cwd: '/threads/thread-1/web', command: '-zsh', terminal: true },
    ])
  })
})

const supported = process.platform === 'darwin' || process.platform === 'linux'

const exited = (child: ChildProcess) =>
  Effect.promise(
    () =>
      new Promise<NodeJS.Signals | number | null>(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) resolve(child.signalCode ?? child.exitCode)
        else child.once('exit', (code, signalName) => resolve(signalName ?? code))
      }),
  )

describe.runIf(supported)('WorkspaceProcesses on the real process table', () => {
  const live = Layer.provideMerge(WorkspaceProcesses.layer, NodeServices.layer)
  const directories = Effect.acquireRelease(
    Effect.sync(() => {
      const root = realpathSync(mkdtempSync(join(tmpdir(), 'jj-workspace-processes-')))
      mkdirSync(join(root, 'thread-1'))
      mkdirSync(join(root, 'thread-10'))
      return { root, workspace: join(root, 'thread-1'), sibling: join(root, 'thread-10') }
    }),
    directories => Effect.sync(() => rmSync(directories.root, { recursive: true, force: true })),
  )
  // Detached: a new session without a controlling terminal, like a dev server an agent left in the background.
  const background = (cwd: string, script: string) =>
    Effect.acquireRelease(
      Effect.sync(() => spawn('/bin/sh', ['-c', script], { cwd, detached: true, stdio: 'ignore' })),
      child => Effect.sync(() => child.exitCode === null && child.signalCode === null && child.kill('SIGKILL')),
    )

  it.live(
    'previews, then stops processes inside the workspace and leaves the sibling folder running',
    () =>
      Effect.gen(function* () {
        using recorder = recordSpans()
        const folders = yield* directories
        const server = yield* background(folders.workspace, 'exec sleep 60')
        const neighbour = yield* background(folders.sibling, 'exec sleep 60')
        const processes = yield* WorkspaceProcesses
        const pid = server.pid ?? -1
        yield* Effect.sleep('300 millis')
        const preview = yield* processes.inspect([folders.workspace, folders.sibling])
        expect(preview.get(folders.workspace)).toContainEqual({ pid, command: 'sleep', outcome: 'would-stop' })
        expect(preview.get(folders.sibling)?.map(found => found.pid)).toEqual([neighbour.pid])
        expect(server.exitCode).toBeNull()

        const stopped = yield* processes.stop({ workspacePath: folders.workspace, grace: '2 seconds' }).pipe(Effect.provide(DshxEffect.tracerLayer))
        expect(stopped).toContainEqual({ pid, command: 'sleep', outcome: 'stopped' })
        expect(yield* exited(server)).toBe('SIGTERM')
        expect(neighbour.exitCode).toBeNull()
        expect(neighbour.signalCode).toBeNull()
        expect(recorder.span('jj-integration workspace processes stop').attributes['dshx.processes.stopped']).toBe(1)
      }).pipe(Effect.scoped, Effect.provide(live)),
    30_000,
  )

  it.live(
    'kills a process that ignores SIGTERM once the grace period ends',
    () =>
      Effect.gen(function* () {
        const folders = yield* directories
        const stubborn = yield* background(folders.workspace, 'trap "" TERM; exec sleep 60')
        yield* Effect.sleep('300 millis')
        const stopped = yield* (yield* WorkspaceProcesses).stop({ workspacePath: folders.workspace, grace: '500 millis' })
        expect(stopped).toContainEqual({ pid: stubborn.pid ?? -1, command: 'sleep', outcome: 'killed' })
        expect(yield* exited(stubborn)).toBe('SIGKILL')
      }).pipe(Effect.scoped, Effect.provide(live)),
    30_000,
  )
})
