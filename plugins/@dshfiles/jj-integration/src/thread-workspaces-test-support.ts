import { execFileSync, spawn } from 'node:child_process'
import { Jj, JjViewReads } from '@dshfiles/jj-cli'
import { NodeFileSystem, NodePath } from '@effect/platform-node'
import { Duration, Effect, Layer, ManagedRuntime, Schema, Sink, Stream } from 'effect'
import { type ChildProcess, ChildProcessSpawner } from 'effect/process'
import { Executables } from './executables-promise.js'
import { jjSettingsTest } from './jj-settings.js'
import { RepoLocks } from './repo-locks.js'
import type { JjIntegrationSettings } from './settings.js'
import { promiseThreads } from './threads-promise.js'
import { ThreadWorkspaces } from './thread-workspaces.js'

/**
 * The real `ThreadWorkspaces` layer for tests, over a process spawner whose jj runs go through `executor`, so a test can
 * observe, delay or rewrite one jj command while everything else runs for real. Other executables (git) are spawned
 * with the command's own environment variables.
 */

export interface JjResult {
  readonly exitCode: number
  readonly stdout: string
  /** The command printed more than the Host keeps; it reaches the service as an over-limit stdout. */
  readonly stdoutLossy?: boolean
  readonly stderr: string
}

export type JjExecutor = (input: { readonly args: readonly string[]; readonly cwd: string }) => Promise<JjResult>

const env = { ...process.env, JJ_CONFIG: '' }
const MAX_STDOUT_BYTES = 512 * 1024

const jjExecutable = (() => {
  try {
    return execFileSync('which', ['jj'], { encoding: 'utf8' }).trim()
  } catch {
    return '/usr/bin/false'
  }
})()

const runProcess = (input: {
  readonly executable: string
  readonly args: readonly string[]
  readonly cwd: string
  readonly env?: ChildProcess.CommandOptions['env']
}): Promise<JjResult> =>
  new Promise(resolvePromise => {
    // A command's own variables (git's scratch `GIT_INDEX_FILE`) apply over the test environment, as on the Host.
    const extra = Object.fromEntries(Object.entries(input.env ?? {}).flatMap(([key, value]) => (typeof value === 'string' ? [[key, value]] : [])))
    const child = spawn(input.executable, input.args, { cwd: input.cwd, env: { ...env, ...extra } })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', chunk => (stdout += String(chunk)))
    child.stderr.on('data', chunk => (stderr += String(chunk)))
    child.on('close', code => resolvePromise({ exitCode: code ?? 1, stdout, stderr }))
    child.on('error', () => resolvePromise({ exitCode: 1, stdout, stderr }))
  })

/** jj itself, with the same flags and environment the Host would use. */
const spawnJj: JjExecutor = input => runProcess({ executable: jjExecutable, args: ['--color=never', '--no-pager', ...input.args], cwd: input.cwd })

class UnsupportedPipeline extends Schema.TaggedError<UnsupportedPipeline>()('UnsupportedPipeline', {}) {}

const encoder = new TextEncoder()

const spawnerFrom = (executor: JjExecutor) =>
  ChildProcessSpawner.make(command =>
    Effect.gen(function* () {
      if (command._tag !== 'StandardCommand') return yield* Effect.die(new UnsupportedPipeline())
      const args = command.args.map(String)
      const cwd = command.options.cwd ?? process.cwd()
      const result = yield* Effect.promise(() =>
        command.command === jjExecutable
          ? executor({ args: args.slice(2), cwd })
          : runProcess({ executable: command.command, args, cwd, env: command.options.env }),
      )
      const stdout = result.stdoutLossy === true ? `${result.stdout}${' '.repeat(MAX_STDOUT_BYTES)}` : result.stdout
      const stdoutStream = Stream.make(encoder.encode(stdout))
      const stderrStream = Stream.make(encoder.encode(result.stderr))
      return ChildProcessSpawner.makeHandle({
        pid: ChildProcessSpawner.ProcessId(-1),
        exitCode: Effect.succeed(ChildProcessSpawner.ExitCode(result.exitCode)),
        isRunning: Effect.succeed(false),
        kill: () => Effect.void,
        stdin: Sink.drain,
        stdout: stdoutStream,
        stderr: stderrStream,
        all: Stream.concat(stdoutStream, stderrStream),
        getInputFd: () => Sink.drain,
        getOutputFd: () => Stream.empty,
        unref: Effect.succeed(Effect.void),
      })
    }),
  )

const threadWorkspacesLayer = (input: { readonly executor?: JjExecutor; readonly settings?: Partial<JjIntegrationSettings> } = {}) =>
  ThreadWorkspaces.layer.pipe(
    Layer.provideMerge(JjViewReads.layer),
    Layer.provideMerge(Jj.layerWith({ executable: jjExecutable, timeout: Duration.minutes(2), maxStdoutBytes: MAX_STDOUT_BYTES })),
    Layer.provideMerge(
      Layer.mergeAll(
        RepoLocks.layer,
        Executables.layerAsGiven,
        jjSettingsTest(input.settings),
        Layer.succeed(ChildProcessSpawner.ChildProcessSpawner, spawnerFrom(input.executor ?? spawnJj)),
        NodeFileSystem.layer,
        NodePath.layer,
      ),
    ),
  )

/** The service as Promises, for tests written against the Promise API; `dispose` releases its scope. */
const createTestThreads = (input: { readonly executor?: JjExecutor; readonly settings?: Partial<JjIntegrationSettings> } = {}) => {
  const runtime = ManagedRuntime.make(threadWorkspacesLayer(input))
  const service = runtime.runSync(
    Effect.gen(function* () {
      return yield* ThreadWorkspaces
    }),
  )
  return {
    ...promiseThreads({ service, run: (effect, signal) => runtime.runPromiseExit(effect, signal === undefined ? undefined : { signal }) }),
    dispose: () => runtime.dispose(),
  }
}

export class ThreadWorkspacesTestSupport {
  static readonly spawnJj = spawnJj
  static readonly layer = threadWorkspacesLayer
  static readonly promiseThreads = createTestThreads
}
