import { describe, expect, it } from '@effect/vitest'
import { Effect, Exit, FileSystem, Fiber, Path, Schedule } from 'effect'
import { Jj } from './jj.ts'
import { JjTestLayer, recordSpans, temporaryRepository } from './test-support.ts'

const DESCRIPTION = ['--ignore-working-copy', 'log', '--no-graph', '-r', '@', '-T', 'description']

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** A jj run that writes the pid of a long-lived child, so a test can check the child is gone afterwards. */
const longRunning = (input: { readonly cwd: string; readonly pidFile: string }) => ({
  args: ['util', 'exec', '--', 'sh', '-c', `echo $$ > "${input.pidFile}.tmp" && mv "${input.pidFile}.tmp" "${input.pidFile}" && exec sleep 30`],
  cwd: input.cwd,
})

const readPid = (pidFile: string) =>
  Effect.gen(function* () {
    const fileSystem = yield* FileSystem.FileSystem
    yield* fileSystem.exists(pidFile).pipe(Effect.repeat({ until: exists => exists, schedule: Schedule.spaced('20 millis') }), Effect.timeout('10 seconds'))
    return Number((yield* fileSystem.readFileString(pidFile)).trim())
  })

describe('Jj', () => {
  it.live('runs jj with the fixed flags and returns its output', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const { repository } = yield* temporaryRepository
      yield* jj.exec({ args: ['describe', '-m', 'first'], cwd: repository })
      const output = yield* jj.run({ args: DESCRIPTION, cwd: repository })
      expect(output).toEqual({ exitCode: 0, stdout: 'first\n', stdoutTruncated: false, stderr: '', stderrTruncated: false })
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('returns a non-zero exit as a value with its stderr', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const { repository } = yield* temporaryRepository
      const output = yield* jj.run({ args: ['log', '-r', 'no_such_revision'], cwd: repository })
      expect(output.exitCode).toBe(1)
      expect(output.stderr).toContain("Revision `no_such_revision` doesn't exist")
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('fails exec with JjCommandFailed carrying redacted args and stderr', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const { repository } = yield* temporaryRepository
      const pattern = 'https://alice:s3cr3tT0ken@example.invalid/repo'
      const raw = yield* jj.run({ args: ['bookmark', 'list', pattern], cwd: repository })
      expect(raw.stderr).toContain('s3cr3tT0ken')

      const failure = yield* jj.exec({ args: ['bookmark', 'list', '-T', 'secret-template', pattern], cwd: repository }).pipe(Effect.flip)
      expect(failure._tag).toBe('JjCommandFailed')
      if (failure._tag !== 'JjCommandFailed') return
      expect(failure.verb).toBe('bookmark list')
      expect(failure.exitCode).not.toBe(0)
      expect(failure.args).toEqual(['bookmark', 'list', '-T', '<redacted>', pattern])
      expect(failure.stderr).toContain('Failed to parse name pattern')
      expect(failure.stderr).toContain('https://<redacted>@example.invalid/repo')
      expect(failure.stderr).not.toContain('s3cr3tT0ken')
      expect(failure.message).toBe('jj bookmark list exited with code 1.')
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('fails with JjOutputTruncated over the stdout cap, or keeps the head when asked to truncate', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const { repository } = yield* temporaryRepository
      yield* jj.exec({ args: ['describe', '-m', 'a description longer than ten bytes'], cwd: repository })
      const failure = yield* jj.run({ args: DESCRIPTION, cwd: repository, maxStdoutBytes: 10 }).pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: 'JjOutputTruncated', verb: 'log', maxBytes: 10 })

      const truncated = yield* jj.run({ args: DESCRIPTION, cwd: repository, maxStdoutBytes: 10, onStdoutLimit: 'truncate' })
      expect(truncated).toMatchObject({ exitCode: 0, stdout: 'a descript', stdoutTruncated: true })
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('stops a run that exceeds its timeout and kills the process', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const path = yield* Path.Path
      const { root, repository } = yield* temporaryRepository
      const pidFile = path.join(root, 'timeout.pid')
      const failure = yield* jj.run({ ...longRunning({ cwd: repository, pidFile }), timeout: '1 second' }).pipe(Effect.flip)
      expect(failure).toMatchObject({ _tag: 'JjTimedOut', verb: 'util exec', timeoutMillis: 1_000 })
      expect(isAlive(yield* readPid(pidFile))).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('kills the process when the caller is interrupted', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const path = yield* Path.Path
      const { root, repository } = yield* temporaryRepository
      const pidFile = path.join(root, 'interrupt.pid')
      const fiber = yield* jj.run(longRunning({ cwd: repository, pidFile })).pipe(Effect.forkChild)
      const pid = yield* readPid(pidFile)
      expect(isAlive(pid)).toBe(true)
      const exit = yield* Fiber.interrupt(fiber).pipe(Effect.andThen(Fiber.await(fiber)))
      expect(Exit.hasInterrupts(exit)).toBe(true)
      expect(isAlive(pid)).toBe(false)
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )

  it.live('records one jj <verb> client span with value-free attributes and the exit code', () =>
    Effect.gen(function* () {
      const jj = yield* Jj
      const { root, repository } = yield* temporaryRepository
      const recorder = recordSpans()
      yield* recorder.trace(jj.run({ args: ['--ignore-working-copy', 'workspace', 'list', '-T', 'name'], cwd: repository }))
      yield* recorder
        .trace(jj.exec({ args: ['workspace', 'add', '--name', 'topic', '-r', 'no_such_revision', `${root}/topic`], cwd: repository }))
        .pipe(Effect.flip)

      const [list] = recorder.named('jj workspace list')
      expect(list?.kind).toBe('client')
      expect(Object.fromEntries(list?.attributes ?? [])).toEqual({
        'process.executable.name': 'jj',
        'process.command.verb': 'workspace list',
        'process.command.flags': ['--ignore-working-copy', '-T'],
        'process.command.arg_count': 5,
        'process.exit.code': 0,
        'jj.output.truncated': false,
      })

      const [add] = recorder.named('jj workspace add')
      expect(add?.attributes.get('process.exit.code')).toBe(1)
      expect(add?.status._tag === 'Ended' && Exit.isFailure(add.status.exit)).toBe(true)
      expect(JSON.stringify(Object.fromEntries(add?.attributes ?? []))).not.toContain(root)
      expect(recorder.spans.map(span => span.name)).toEqual(['jj workspace list', 'jj workspace add'])
    }).pipe(Effect.scoped, Effect.provide(JjTestLayer)),
  )
})
