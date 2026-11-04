import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, Fiber, FileSystem, Path, Schedule } from 'effect'
import { Jj } from './jj.ts'
import { JjViewReads } from './jj-view-reads.ts'
import { JjTestLayer, recordSpans, temporaryRepository } from './test-support.ts'

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const readPid = (pidFile: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.exists(pidFile).pipe(Effect.repeat({ until: exists => exists, schedule: Schedule.spaced('20 millis') }), Effect.timeout('10 seconds'))
    return Number((yield* fileSystem.readFileString(pidFile)).trim())
  })

/** A view read that runs a configured diff tool for two seconds and writes its pid, so a test can interrupt it mid-read. */
const slowViewRead = Effect.gen(function* () {
  const jj = yield* Jj
  const fileSystem = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const { root, repository } = yield* temporaryRepository
  yield* fileSystem.writeFileString(path.join(repository, 'file.txt'), 'changed\n')
  yield* jj.exec({ args: ['status'], cwd: repository })
  const pidFile = path.join(root, 'diff-tool.pid')
  const spawnLog = path.join(root, 'diff-tool.spawns')
  const script = `echo $$ >> "${spawnLog}" && echo $$ > "${pidFile}.tmp" && mv "${pidFile}.tmp" "${pidFile}" && sleep 2 && echo slow diff done`
  const command = {
    args: [
      '--ignore-working-copy',
      'diff',
      '-r',
      '@',
      '--tool',
      'slow',
      '--config',
      'merge-tools.slow.program="sh"',
      '--config',
      `merge-tools.slow.diff-args=${JSON.stringify(['-c', script])}`,
    ],
    cwd: repository,
  }
  const spawns = Effect.map(fileSystem.readFileString(spawnLog), log => log.trim().split('\n').length)
  return { command, pidFile, spawns }
})

const describeAt = (cwd: string) => ({ args: ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'description'], cwd })

describe('JjViewReads against real jj', () => {
  it.live('answers a repeated view read without spawning jj until an operation lands', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const reads = yield* JjViewReads
      const { repository } = yield* temporaryRepository
      const recorder = recordSpans()

      expect((yield* recorder.trace(reads.read(describeAt(repository)))).stdout).toBe('')
      expect((yield* recorder.trace(reads.read(describeAt(repository)))).stdout).toBe('')
      expect(recorder.named('jj log')).toHaveLength(1)

      yield* jj.exec({ args: ['describe', '-m', 'first'], cwd: repository })
      expect((yield* recorder.trace(reads.read(describeAt(repository)))).stdout).toBe('first\n')
      expect(recorder.named('jj log')).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('shares the operation head with a secondary workspace of the same store', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const reads = yield* JjViewReads
      const path = yield* Path.Path
      const { root, repository } = yield* temporaryRepository
      const secondary = path.join(root, 'secondary')
      yield* jj.exec({ args: ['workspace', 'add', secondary], cwd: repository })
      const recorder = recordSpans()

      yield* recorder.trace(reads.read(describeAt(secondary)))
      yield* recorder.trace(reads.read(describeAt(secondary)))
      expect(recorder.named('jj log')).toHaveLength(1)
      yield* jj.exec({ args: ['describe', '-m', 'from the main workspace'], cwd: repository })
      yield* recorder.trace(reads.read(describeAt(secondary)))
      expect(recorder.named('jj log')).toHaveLength(2)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('does not cache a failed read or a command that is not a view read', () =>
    Effect.gen(function* () {
      const reads = yield* JjViewReads
      const { repository } = yield* temporaryRepository
      const recorder = recordSpans()
      const missing = { args: ['--ignore-working-copy', 'log', '-r', 'no_such_revision'], cwd: repository }
      expect((yield* recorder.trace(reads.read(missing))).exitCode).toBe(1)
      expect((yield* recorder.trace(reads.read(missing))).exitCode).toBe(1)
      expect(recorder.named('jj log')).toHaveLength(2)

      yield* recorder.trace(reads.read({ args: ['log', '--no-graph', '-r', '@', '-T', 'description'], cwd: repository }))
      yield* recorder.trace(reads.read({ args: ['log', '--no-graph', '-r', '@', '-T', 'description'], cwd: repository }))
      expect(recorder.named('jj log')).toHaveLength(4)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('keeps a shared read running for the other waiter when one caller is interrupted', () =>
    Effect.gen(function* () {
      const reads = yield* JjViewReads
      const slow = yield* slowViewRead
      const recorder = recordSpans()
      const first = yield* recorder.trace(reads.read(slow.command)).pipe(Effect.forkChild({ startImmediately: true }))
      const second = yield* recorder.trace(reads.read(slow.command)).pipe(Effect.forkChild({ startImmediately: true }))
      const pid = yield* readPid(slow.pidFile)
      const firstExit = yield* Fiber.interrupt(first).pipe(Effect.andThen(Fiber.await(first)))
      expect(Exit.hasInterrupts(firstExit)).toBe(true)
      expect(isAlive(pid)).toBe(true)

      expect((yield* Fiber.join(second)).stdout).toBe('slow diff done\n')
      expect(yield* slow.spawns).toBe(1)
      const diffs = recorder.named('jj diff')
      expect(diffs).toHaveLength(1)
      expect(diffs[0]?.status._tag === 'Ended' && Exit.isSuccess(diffs[0].status.exit)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('interrupts the shared read and kills jj when its last waiter is interrupted', () =>
    Effect.gen(function* () {
      const reads = yield* JjViewReads
      const slow = yield* slowViewRead
      const recorder = recordSpans()
      const only = yield* recorder.trace(reads.read(slow.command)).pipe(Effect.forkChild)
      const pid = yield* readPid(slow.pidFile)
      yield* Fiber.interrupt(only)
      yield* Effect.sync(() => isAlive(pid)).pipe(Effect.repeat({ while: alive => alive, schedule: Schedule.spaced('20 millis') }), Effect.timeout('5 seconds'))
      const [diff] = recorder.named('jj diff')
      expect(diff?.status._tag === 'Ended' && Exit.hasInterrupts(diff.status.exit)).toBe(true)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it('only treats --ignore-working-copy reads as view reads', () => {
    expect(JjViewReads.isViewRead(['--ignore-working-copy', 'workspace', 'list'])).toBe(true)
    expect(JjViewReads.isViewRead(['--ignore-working-copy', 'workspace', 'forget', 'thread-1'])).toBe(false)
    expect(JjViewReads.isViewRead(['log', '-r', '@'])).toBe(false)
  })
})
