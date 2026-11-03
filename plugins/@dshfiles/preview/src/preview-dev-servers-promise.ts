import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from '@deepseek-ai/dsh-subprocess'
import { HostContext } from '@dshfiles/dshx/effect'
import { Context, Deferred, Effect, FileSystem, Layer, Ref, Schema } from 'effect'
import { DevServers, type DevServer, type KnownSession, type LiveJob } from './dev-servers.js'

const PROBE_TIMEOUT_MS = 10_000
const SESSIONS_TIMEOUT_MS = 2_500
const PROBE_TTL_MS = 3_000
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024
const MAX_CWD_PROBES = 200

export interface DevServerProbeResult {
  readonly supported: boolean
  readonly servers: readonly DevServer[]
}

/** A read-only probe command failed; the thread dev-server list is unavailable until it retries. */
export class PreviewProbeFailed extends Schema.TaggedError<PreviewProbeFailed>()(
  'PreviewProbeFailed',
  { command: Schema.String, cause: Schema.optional(Schema.Defect()) },
  { dshxWireCode: 'preview-probe-failed' },
) {
  override get message(): string {
    return `The dev-server probe could not run ${this.command}. Retry; if it keeps failing, check that the process tools are installed.`
  }
}

/** One read-only probe command's stdout, as the Host or a test supplies it. */
export type ProbeExec = (command: string, args: readonly string[]) => Promise<string>

/** Runs one read-only probe command through the DSH subprocess service, bounded and timed out. */
export const contextProbeExec =
  (ctx: HostContext['Service']['ctx']): ProbeExec =>
  (command, args) =>
    runProbe({ ctx, command, args }).pipe(Effect.runPromise)

const runProbe = (input: { readonly ctx: HostContext['Service']['ctx']; readonly command: string; readonly args: readonly string[] }) =>
  Effect.gen(function* () {
    const signal = AbortSignal.timeout(PROBE_TIMEOUT_MS)
    const executable = yield* Effect.promise(() => input.ctx.subprocess.resolveExecutable(input.command, undefined, signal))
    const handle = input.ctx.subprocess.spawn({
      argv: [executable, ...input.args],
      cwd: process.env.HOME ?? '/',
      env: { ...process.env, LC_ALL: 'C' },
      stdio: { stdin: 'ignore', stdout: { maxBytes: MAX_OUTPUT_BYTES }, stderr: { maxBytes: 64 * 1024 } },
      graceMs: 500,
      signal,
    })
    // lsof exits 1 when nothing matches; its stdout is still the answer.
    yield* Effect.promise(() => handle.done.catch(() => undefined))
    return handle.collected.stdout?.readFrom(0)?.text ?? ''
  })

/** The Host processes, sessions and job labels one dev-server list is attributed from. */
export class PreviewDevServers extends Context.Service<
  PreviewDevServers,
  {
    readonly read: (fresh: boolean) => Effect.Effect<DevServerProbeResult, PreviewProbeFailed>
    readonly invalidate: Effect.Effect<void>
    readonly readProcessTable: Effect.Effect<ReturnType<typeof DevServers.parsePs>, PreviewProbeFailed>
  }
>()('@dshfiles/preview/PreviewDevServers') {
  static readonly makeLayer = (options: { readonly exec?: ProbeExec } = {}) =>
    Layer.effect(
      PreviewDevServers,
      Effect.gen(function* () {
        const host = yield* HostContext
        const fs = yield* FileSystem.FileSystem
        const cached = yield* Ref.make<{ readonly at: number; readonly result: Effect.Effect<DevServerProbeResult, PreviewProbeFailed> } | undefined>(undefined)
        const liveJobs = yield* Ref.make<readonly LiveJob[]>([])

        const exec = options.exec ?? contextProbeExec(host.ctx)
        const probeExec = (command: string, args: readonly string[]) =>
          Effect.tryPromise({
            try: () => exec(command, args),
            catch: cause => new PreviewProbeFailed({ command, cause }),
          }).pipe(Effect.withSpan('preview port-probe', { kind: 'client', attributes: { 'process.executable.name': command } }))

        const sessions = Effect.gen(function* () {
          const controller = host.ctx.get('sessionController')
          if (controller === undefined) return []
          const listed = yield* Effect.promise(() => controller.list({}, AbortSignal.timeout(SESSIONS_TIMEOUT_MS)).catch(() => undefined))
          return (listed?.items ?? []).map((summary): KnownSession => ({ sessionId: summary.sessionId, cwd: summary.cwd ?? null }))
        })

        const readCwds = (pids: readonly number[]) =>
          Effect.gen(function* () {
            const cwds = new Map<number, string>()
            const probed = pids.slice(0, MAX_CWD_PROBES)
            if (probed.length === 0) return cwds
            if (process.platform === 'linux') {
              yield* Effect.forEach(
                probed,
                pid =>
                  fs.readLink(`/proc/${String(pid)}/cwd`).pipe(
                    Effect.tap(cwd => Effect.sync(() => cwds.set(pid, cwd))),
                    Effect.ignore,
                  ),
                { concurrency: 'unbounded', discard: true },
              )
              return cwds
            }
            const output = yield* probeExec('lsof', ['-a', '-d', 'cwd', '-F', 'pn', '-p', probed.join(',')])
            let current: number | undefined
            for (const line of output.split('\n')) {
              if (line.startsWith('p')) current = Number(line.slice(1))
              else if (line.startsWith('n') && current !== undefined) cwds.set(current, line.slice(1))
            }
            return cwds
          })

        const probe = Effect.gen(function* () {
          if (process.platform !== 'darwin' && process.platform !== 'linux') return { supported: false, servers: [] }
          const socketsText = yield* probeExec(
            process.platform === 'linux' ? 'ss' : 'lsof',
            process.platform === 'linux' ? ['-ltnpH'] : ['-nP', '-iTCP', '-sTCP:LISTEN', '-a', '-u', String(process.getuid?.() ?? 0), '-F', 'pn'],
          )
          const sockets = process.platform === 'linux' ? DevServers.parseSsListeners(socketsText) : DevServers.parseLsofListeners(socketsText)
          // No listening socket means no row to attribute: skip the process table, the cwd probes and the Session
          // fold. Every poll of an idle thread used to pay all three to return `servers: []`.
          if (sockets.length === 0) return { supported: true, servers: [] }
          const rows = DevServers.parsePs(yield* probeExec('ps', ['-ww', '-x', '-U', String(process.getuid?.() ?? 0), '-o', 'pid=,ppid=,lstart=,args=']))
          const known = yield* sessions
          const cwds = yield* readCwds([...new Set(sockets.map(socket => socket.pid))])
          const jobs = yield* Ref.get(liveJobs)
          return {
            supported: true,
            servers: DevServers.attribute({ sockets, rows, cwds, hostPid: process.pid, home: process.env.HOME ?? '', sessions: known, jobs }),
          }
        })

        const read = (fresh: boolean) =>
          Effect.gen(function* () {
            const now = Date.now()
            const current = yield* Ref.get(cached)
            if (!fresh && current !== undefined && now - current.at < PROBE_TTL_MS) return yield* current.result
            const shared = yield* Deferred.make<DevServerProbeResult, PreviewProbeFailed>()
            const result = Deferred.await(shared)
            yield* Ref.set(cached, { at: now, result })
            return yield* Effect.scoped(
              probe.pipe(
                Effect.onExit(exit => Deferred.done(shared, exit)),
                Effect.ignore,
                Effect.forkScoped,
                Effect.andThen(result),
              ),
            )
          })

        /** Live jobs the Host reports, so a probe attributes a dev server to the job that started it. */
        host.ctx.inject(['jobs'], scoped => {
          const registry = scoped.get('jobs')
          if (registry === undefined) return
          scoped.effect(() => {
            const unsubscribe = registry.events.subscribe({ owners: 'all' }, event => {
              if (event.type === 'output') return
              Effect.runSync(
                Ref.update(liveJobs, current =>
                  event.type === 'removed'
                    ? current.filter(job => job.id !== event.job.id)
                    : [
                        ...current.filter(job => job.id !== event.job.id),
                        { id: event.job.id, label: event.job.label, owner: event.job.owner ?? null, startedAt: event.job.startedAt },
                      ],
                ),
              )
            })
            return () => unsubscribe()
          }, 'preview: live job tracking')
        })

        return PreviewDevServers.of({
          read,
          invalidate: Ref.set(cached, undefined),
          readProcessTable: probeExec('ps', ['-ww', '-x', '-U', String(process.getuid?.() ?? 0), '-o', 'pid=,ppid=,lstart=,args=']).pipe(
            Effect.map(DevServers.parsePs),
          ),
        })
      }),
    )

  static readonly layer = PreviewDevServers.makeLayer()
}
