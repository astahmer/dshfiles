import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { ActivityLog } from './host-edges-promise.js'
import { MaintenanceFailures, type MaintenanceFailure } from './maintenance-failures.js'

type Emitted = Parameters<ActivityLog['Service']['emit']>[0]

/** The reporter over an activity log that records what it was asked to emit. */
const reporter = Effect.gen(function* () {
  const emitted: Emitted[] = []
  const failures = yield* MaintenanceFailures.make.pipe(
    Effect.provide(Layer.succeed(ActivityLog, ActivityLog.of({ emit: input => Effect.sync(() => void emitted.push(input)) }))),
  )
  return { failures, emitted }
})

const finished: MaintenanceFailure = {
  kind: 'finished-thread',
  repoRoot: '/work/sample',
  name: 'thread-aaaaaa',
  path: '/work/sample-threads/thread-aaaaaa',
  reason: 'Could not remove /work/sample-threads/thread-aaaaaa. PermissionDenied: FileSystem.remove (/work/sample-threads/thread-aaaaaa)',
}

describe('MaintenanceFailures', () => {
  it.effect('reports a finished-thread removal that failed on its project, with the reason and a recovery that never forces', () =>
    Effect.gen(function* () {
      const { failures, emitted } = yield* reporter
      yield* failures.failed(finished)

      expect(emitted).toHaveLength(1)
      expect(emitted[0]).toMatchObject({
        type: 'workspace.cleanup-failed',
        level: 'attention',
        path: '/work/sample',
        summary: 'Could not remove finished thread workspace thread-aaaaaa in sample',
      })
      expect(emitted[0]?.detail).toContain('PermissionDenied')
      expect(emitted[0]?.detail).toContain('removal never forces unlanded work')
      expect(emitted[0]?.detail).toContain('remove it from its row in the sample Jujutsu panel')
    }),
  )

  it.effect('reports each sweep failure once per reason, and again after a success or with a new reason', () =>
    Effect.gen(function* () {
      const { failures, emitted } = yield* reporter
      yield* failures.failed(finished)
      yield* failures.failed(finished)
      expect(emitted).toHaveLength(1)

      yield* failures.failed({ ...finished, reason: 'jj workspace forget exited 1' })
      expect(emitted).toHaveLength(2)

      yield* failures.cleared('finished-thread', finished.path)
      yield* failures.failed({ ...finished, reason: 'jj workspace forget exited 1' })
      expect(emitted).toHaveLength(3)

      // Another kind on the same folder is its own failure.
      yield* failures.failed({ ...finished, kind: 'kept-thread' })
      expect(emitted).toHaveLength(4)
    }),
  )

  it('names the exact command that retries an archived thread’s dependency cleanup', () => {
    const { summary, detail } = MaintenanceFailures.report({
      kind: 'kept-thread',
      repoRoot: '/work/sample',
      name: 'thread-bbbbbb',
      path: '/work/sample-threads/thread-bbbbbb',
      reason: 'The cleanup script exited with code 1.',
      command: '/work/.dsh/cleanup.sh /work/sample-threads/thread-bbbbbb',
    })

    expect(summary).toBe('Could not clear the dependencies of archived thread thread-bbbbbb in sample')
    expect(detail).toContain('The cleanup script exited with code 1.')
    expect(detail).toContain('folder and unlanded work are kept')
    expect(detail).toContain('run /work/.dsh/cleanup.sh /work/sample-threads/thread-bbbbbb')
    expect(MaintenanceFailures.report({ ...finished, kind: 'kept-thread' }).detail).toContain('delete that node_modules folder')
  })

  it('quotes the retry command so a path with a space or a quote still runs as printed', () => {
    expect(MaintenanceFailures.commandLine(['/work/.dsh/cleanup.sh', '/work/sample-threads/thread-bbbbbb'], 'darwin')).toBe(
      '/work/.dsh/cleanup.sh /work/sample-threads/thread-bbbbbb',
    )
    expect(MaintenanceFailures.commandLine(['/Users/me/My Projects/cleanup.sh', "/work/it's-threads/thread-b"], 'linux')).toBe(
      `'/Users/me/My Projects/cleanup.sh' '/work/it'\\''s-threads/thread-b'`,
    )
    expect(MaintenanceFailures.commandLine(['C:\\Program Files\\dsh\\cleanup.cmd', 'C:\\work\\sample-threads\\thread-b'], 'win32')).toBe(
      '"C:\\Program Files\\dsh\\cleanup.cmd" C:\\work\\sample-threads\\thread-b',
    )
  })
})
