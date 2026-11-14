/**
 * dshfiles delta: run systemctl from small, pooled helper processes instead of forking the Host.
 *
 * Every fork copies the forking process's page tables while it holds that process's memory map, so
 * a 2 GB Host stalls its event loop for each `systemctl` it runs (17 ms per call measured), even
 * when the fork happens on a worker thread, which shares the memory map (11 ms). A helper is forked
 * once per burst and then forks only itself, a few tens of MB, per command (2 ms, the idle floor).
 *
 * Effect owns the lifecycle: the Pool forks a helper on demand, hands it to one command at a time,
 * retires it after 30 s unused, and its scope kills it; the runtime's disposal kills the rest.
 * The plain-Promise native code reaches it through systemctl-promise.ts.
 */
import { NodeServices } from '@effect/platform-node'
import { Context, Duration, Effect, Layer, Pool, Queue, Stream } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export interface SystemctlResult {
  status: number | null
  stdout: string
  stderr: string
  error?: Error
}

export interface SystemctlRequest {
  readonly command: string
  readonly args: readonly string[]
  readonly env: NodeJS.ProcessEnv
  /** The helper kills the command after this long; the Host abandons the helper shortly after. */
  readonly timeoutMs: number
}

/**
 * The helper: one JSON request per stdin line, one JSON result per stdout line, in order. It exits
 * when stdin closes, so a Host that dies without disposing its runtime leaves no helper behind.
 */
const HELPER_SOURCE = `
const { execFile } = require('node:child_process');
const reply = result => process.stdout.write(JSON.stringify(result) + '\\n');
const lines = require('node:readline').createInterface({ input: process.stdin });
lines.on('line', line => {
  const { command, args, env, timeoutMs } = JSON.parse(line);
  try {
    execFile(command, args, { encoding: 'utf8', env, timeout: timeoutMs }, (error, stdout, stderr) => reply({
      status: error === null ? 0 : typeof error.code === 'number' ? error.code : null,
      stdout, stderr, failure: error === null ? null : error.message,
    }));
  } catch (error) {
    reply({ status: null, stdout: '', stderr: '', failure: String(error && error.message || error) });
  }
});
lines.on('close', () => process.exit(0));
`

/** How long past the command's own timeout the Host waits for the helper before abandoning it. */
const HELPER_GRACE = Duration.seconds(2)
const HELPER_MAX = 4
const HELPER_IDLE = Duration.seconds(30)

interface Reply {
  readonly status: number | null
  readonly stdout: string
  readonly stderr: string
  readonly failure: string | null
}

const decodeReply = (line: string): SystemctlResult => {
  const reply = JSON.parse(line) as Reply
  return {
    status: reply.status,
    stdout: reply.stdout,
    stderr: reply.stderr,
    ...reply.failure === null ? {} : { error: new Error(reply.failure) },
  }
}

export const failedResult = (cause: unknown): SystemctlResult => ({
  status: null,
  stdout: '',
  stderr: '',
  error: cause instanceof Error ? cause : new Error(`systemctl helper failed: ${String(cause)}`),
})

/** One helper process, serving one exchange at a time (the Pool guarantees exclusivity). */
const spawnHelper = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner
  const requests = yield* Queue.unbounded<string>()
  const handle = yield* spawner.spawn(ChildProcess.make(process.execPath, ['-e', HELPER_SOURCE], {
    // The helper inherits nothing from the Host: each command carries its own environment.
    env: {},
    extendEnv: false,
    stdin: Stream.fromQueue(requests).pipe(Stream.encodeText),
    stderr: 'ignore',
  }))
  const replies = yield* Queue.unbounded<string, unknown>()
  yield* handle.stdout.pipe(Stream.decodeText(), Stream.splitLines, Stream.runIntoQueue(replies), Effect.forkScoped)
  return {
    exchange: (request: SystemctlRequest) => Queue.offer(requests, `${JSON.stringify(request)}\n`).pipe(
      Effect.andThen(Queue.take(replies)),
      Effect.map(decodeReply),
      Effect.timeout(Duration.sum(Duration.millis(request.timeoutMs), HELPER_GRACE)),
    ),
  }
})

export class SystemctlRunner extends Context.Service<
  SystemctlRunner,
  {
    /** Run one bounded command; failures are returned in the result, never raised. */
    readonly run: (request: SystemctlRequest) => Effect.Effect<SystemctlResult>
  }
>()('@dshfiles/subprocess-local/SystemctlRunner') {
  static readonly make = Effect.gen(function* () {
    const helpers = yield* Pool.makeWithTTL({
      acquire: spawnHelper,
      min: 0,
      max: HELPER_MAX,
      timeToLive: HELPER_IDLE,
      timeToLiveStrategy: 'usage',
    })
    return SystemctlRunner.of({
      run: request => Effect.scoped(Effect.gen(function* () {
        const helper = yield* Pool.get(helpers)
        // A helper that missed its reply is out of step with its stream: never reuse it.
        return yield* helper.exchange(request).pipe(Effect.tapError(() => Pool.invalidate(helpers, helper)))
      })).pipe(Effect.catch(cause => Effect.succeed(failedResult(cause)))),
    })
  })

  /** The runner over a caller-provided spawner; tests count helper forks through it. */
  static readonly layerWithoutSpawner = Layer.effect(SystemctlRunner, SystemctlRunner.make)

  static readonly layer = SystemctlRunner.layerWithoutSpawner.pipe(Layer.provide(NodeServices.layer))
}
