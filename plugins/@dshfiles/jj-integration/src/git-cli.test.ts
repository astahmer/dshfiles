import { spawnSync } from 'node:child_process'
import { mkdtempSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { recordSpans } from '@dshfiles/dshx/tracing'
import { NodeServices } from '@effect/platform-node'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Layer } from 'effect'
import { Executables } from './executables-promise.js'
import { GitCli } from './git-cli.js'

const gitAvailable = spawnSync('git', ['--version']).status === 0
const GitLive = GitCli.layer.pipe(Layer.provide(Layer.mergeAll(Executables.layerAsGiven, NodeServices.layer)))

describe.skipIf(!gitAvailable)('GitCli', () => {
  it.effect('records one git <verb> client span with value-free attributes and the exit code', () =>
    Effect.gen(function* () {
      using recorder = recordSpans()
      const directory = realpathSync(mkdtempSync(join(tmpdir(), 'git-cli-')))
      yield* Effect.addFinalizer(() => Effect.sync(() => rmSync(directory, { recursive: true, force: true })))
      const git = yield* GitCli
      const outside = yield* git.run({ args: ['rev-parse', '--show-toplevel'], cwd: directory })
      expect(outside.exitCode).not.toBe(0)
      const failure = yield* git.exec({ args: ['rev-parse', '--show-toplevel'], cwd: directory }).pipe(Effect.flip)
      expect(failure._tag).toBe('GitFailed')
      expect(failure.message).toContain('git rev-parse:')
      const span = recorder.span('git rev-parse')
      expect(span.kind).toBe('client')
      expect(span.attributes['process.exit.code']).toBe(outside.exitCode)
      // Paths and values never reach a span.
      expect(JSON.stringify(span.attributes)).not.toContain(directory)
    }).pipe(Effect.provide(Layer.merge(GitLive, DshxEffect.tracerLayer)), Effect.scoped),
  )
})
