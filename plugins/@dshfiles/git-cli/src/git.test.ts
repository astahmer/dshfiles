import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Duration, Effect, Exit, Layer, Tracer } from 'effect'
import { Git } from './git.js'
import { GitArgs } from './git-args.js'
import { redactGitStderr } from './stderr-redaction.js'

const GitTestLayer = Git.layer.pipe(Layer.provide(NodeServices.layer))

const temporaryDirectory = Effect.acquireRelease(
  Effect.sync(() => realpathSync(mkdtempSync(join(tmpdir(), 'git-cli-')))),
  directory => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
)

const recordSpans = () => {
  const spans: Tracer.NativeSpan[] = []
  const tracer = Tracer.make({
    span: options => {
      const span = new Tracer.NativeSpan(options)
      spans.push(span)
      return span
    },
  })
  return {
    spans,
    named: (name: string) => spans.filter(span => span.name === name),
    trace: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.withTracer(effect, tracer),
  }
}

describe('Git', () => {
  it.live('records one git <verb> client span with value-free attributes and the exit code', () =>
    Effect.gen(function* () {
      const git = yield* Git
      const directory = yield* temporaryDirectory
      const recorder = recordSpans()
      yield* recorder.trace(git.run({ args: ['init', '-q', '-b', 'main', directory], cwd: directory }))
      const outside = yield* recorder.trace(git.exec({ args: ['rev-parse', '--verify', 'no-such-ref'], cwd: directory })).pipe(Effect.flip)

      const [init] = recorder.named('git init')
      expect(init?.kind).toBe('client')
      expect(Object.fromEntries(init?.attributes ?? [])).toEqual({
        'process.executable.name': 'git',
        'process.command.verb': 'init',
        'process.command.flags': ['-c', '-q', '-b'],
        'process.command.arg_count': 7,
        'process.exit.code': 0,
      })
      const [revParse] = recorder.named('git rev-parse')
      expect(revParse?.attributes.get('process.exit.code')).toBe(128)
      expect(revParse?.status._tag === 'Ended' && Exit.isFailure(revParse.status.exit)).toBe(true)
      expect(JSON.stringify(recorder.spans.map(span => Object.fromEntries(span.attributes)))).not.toContain(directory)
      expect(outside._tag).toBe('GitCommandFailed')
      expect(outside.message).toContain('git rev-parse:')
    }).pipe(Effect.provide(GitTestLayer), Effect.scoped),
  )

  it.live('stops a run that exceeds its timeout', () =>
    Effect.gen(function* () {
      const directory = yield* temporaryDirectory
      const slow = join(directory, 'slow-git')
      writeFileSync(slow, '#!/bin/sh\nsleep 30\n')
      chmodSync(slow, 0o755)
      const started = Date.now()
      const failure = yield* Git.use(git => git.run({ args: ['status'], cwd: directory, timeout: Duration.millis(300) })).pipe(
        Effect.provide(Git.layerWith({ executable: slow }).pipe(Layer.provide(NodeServices.layer))),
        Effect.flip,
      )
      expect(failure.reason).toBe('timed-out')
      expect(Date.now() - started).toBeLessThan(10_000)
    }).pipe(Effect.scoped),
  )

  it('keeps flag values and credentials out of errors', () => {
    expect(GitArgs.redact(['commit', '-m', 'private message', '--format=%H'])).toEqual(['commit', '-m', '<redacted>', '--format=<redacted>'])
    expect(redactGitStderr("fatal: unable to access 'https://user:token@example.com/repo.git/'")).toBe(
      "fatal: unable to access 'https://<redacted>@example.com/repo.git/'",
    )
    expect(GitArgs.spanName(['worktree', 'add', '-b', 'dsh/thread-abcdef', '/tmp/x'])).toBe('git worktree')
  })
})
