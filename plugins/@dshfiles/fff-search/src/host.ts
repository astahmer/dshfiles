/**
 * Agent `grep` and `glob` on a resident fff index. The stock `@deepseek-ai/dsh-tool-fs-search` spawns ripgrep on every
 * call; on a loaded machine that measured 3.1 s median per DSH grep call, against a few hundred milliseconds on a warm
 * fff index (plans/fff-search). The stock tools stay registered globally: on each `agent/created` this plugin registers
 * its own through `agent.ctx`, and an Agent-scoped tool shadows the global tool of the same name. fff queries are
 * synchronous FFI calls, so the indexes live in a worker thread and the Host only posts messages.
 */
import '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import '@deepseek-ai/dsh-working-directory'
import { DshxEffect } from '@dshfiles/dshx/effect'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import { Effect, ManagedRuntime } from 'effect'
import type { z } from 'zod'
import { stat } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { FffSearch } from './fff-search.js'

/** Matches the stock grep's cooperative timeout; a request still pending then is failed, not left hanging. */
const REQUEST_TIMEOUT_MS = 30_000

type WorkerRequest = z.input<typeof FffSearch.workerRequest>
type WorkerReply = z.infer<typeof FffSearch.workerReply>
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

type FffEffectRuntime = ManagedRuntime.ManagedRuntime<never, never>

export default defineHost({
  name: '@dshfiles/fff-search',
  inject: ['tools', 'workingDirectory'],
  setup: DshxEffect.setup(ctx =>
    Effect.acquireRelease(
      Effect.sync(() => {
        let worker: Worker | undefined
        let nextId = 1
        let runtime: FffEffectRuntime | undefined
        const pending = new Map<number, { settle: (reply: WorkerReply) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>()

        const failPending = (error: Error): void => {
          for (const request of pending.values()) {
            clearTimeout(request.timer)
            request.reject(error)
          }
          pending.clear()
        }

        const ensureWorker = (): Worker => {
          if (worker !== undefined) return worker
          const spawned = new Worker(new URL('./fff-worker.js', import.meta.url), { workerData: { stateRoot: dshHomePath('plugins', 'fff-search') } })
          // oxlint-disable-next-line antislop/no-unknown-parameters -- The worker message boundary; `workerReply.safeParse` runs on the next line.
          spawned.on('message', (raw: unknown) => {
            const reply = FffSearch.workerReply.safeParse(raw)
            if (!reply.success) return
            const request = pending.get(reply.data.id)
            if (request === undefined) return
            pending.delete(reply.data.id)
            clearTimeout(request.timer)
            request.settle(reply.data)
          })
          spawned.on('error', error => ctx.logger.warn(`fff-search: worker failed: ${error.message}`))
          // A crashed worker takes its indexes with it; the next search spawns a fresh one.
          spawned.on('exit', code => {
            if (worker === spawned) worker = undefined
            failPending(new Error(`fff-search worker exited with code ${String(code)}`))
          })
          spawned.unref()
          worker = spawned
          return spawned
        }

        const ask = Effect.fn('fff search worker request')((request: DistributiveOmit<WorkerRequest, 'id'>) =>
          Effect.tryPromise({
            try: () =>
              new Promise<WorkerReply>((settle, reject) => {
                const id = nextId++
                const timer = setTimeout(() => {
                  pending.delete(id)
                  reject(new Error(`fff-search ${request.kind} did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`))
                }, REQUEST_TIMEOUT_MS)
                pending.set(id, { settle, reject, timer })
                ensureWorker().postMessage({ ...request, id })
              }),
            catch: error => (error instanceof Error ? error : new Error(String(error))),
          }),
        )

        const resolveScope = Effect.fn('fff search path resolve')((options: { workingDirectory: string; path: string | undefined }) =>
          Effect.gen(function* () {
            const target = FffSearch.target({ workingDirectory: options.workingDirectory, path: options.path })
            const found = options.path === undefined ? undefined : yield* Effect.tryPromise({ try: () => stat(target), catch: () => undefined })
            return FffSearch.scope({
              workingDirectory: options.workingDirectory,
              path: options.path,
              target,
              stats: found === undefined ? undefined : { isFile: found.isFile() },
            })
          }),
        )

        const run = <A, E>(effect: Effect.Effect<A, E>, signal?: AbortSignal): Promise<A> => {
          if (runtime === undefined) return Promise.reject(new Error('fff-search Effect runtime is not active'))
          return runtime.runPromise(effect, { signal })
        }

        runtime = ManagedRuntime.make(DshxEffect.tracerLayer)
        const perAgent = new Map<string, () => void>()
        const offCreated = ctx.on('agent/created', ({ agent }) => {
          perAgent.get(agent.id)?.()
          const disposeGrep = agent.ctx.tools.register(grepTool)
          const disposeGlob = agent.ctx.tools.register(globTool)
          perAgent.set(agent.id, () => {
            disposeGrep()
            disposeGlob()
          })
          void run(
            Effect.tryPromise({
              try: () => ctx.workingDirectory.ensure(agent),
              catch: error => (error instanceof Error ? error : new Error(String(error))),
            }).pipe(Effect.flatMap(workingDirectory => ask({ kind: 'warm', root: workingDirectory }))),
          )
            .then(reply => {
              if (!reply.ok) ctx.logger.warn(`fff-search: index warm-up failed: ${reply.error}`)
            })
            .catch(error => ctx.logger.warn(`fff-search: index warm-up failed: ${String(error)}`))
          return undefined
        })
        const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
          perAgent.get(agent.id)?.()
          perAgent.delete(agent.id)
          return undefined
        })

        const grepTool = defineTool({
          name: 'grep',
          description: `Search file contents with a regular expression (Rust regex syntax, like ripgrep) over an indexed, .gitignore-aware view of the workspace. Returns matching lines with line numbers, grouped by file, most relevant files first. Returns up to ${FffSearch.maxGrepMatches} matches and the total count.`,
          parameters: {
            pattern: { type: 'string', required: true, description: 'Regular expression to search for.' },
            path: { type: 'string', description: 'File or directory to search. Defaults to the session workspace; a relative path resolves against it.' },
            include: {
              type: 'string',
              description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.',
            },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                matches: {
                  type: 'array',
                  required: true,
                  items: {
                    type: 'object',
                    additionalProperties: false,
                    properties: {
                      path: { type: 'string', required: true },
                      lineNumber: { type: 'integer', required: true },
                      line: { type: 'string', required: true },
                    },
                  },
                },
                total: { type: 'integer', required: true },
                totalIsLowerBound: { type: 'boolean', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: FffSearch.renderGrep(value) }],
          },
          isConcurrencySafe: () => true,
          execute: (args, exec) => {
            const agent = exec.agent
            if (agent === undefined) return Promise.reject(new Error('fff-search grep runs only on behalf of an Agent'))
            return run(
              Effect.gen(function* () {
                const workingDirectory = yield* Effect.tryPromise({
                  try: () => ctx.workingDirectory.ensure(agent, exec.signal),
                  catch: error => (error instanceof Error ? error : new Error(String(error))),
                })
                const scope = yield* resolveScope({ workingDirectory, path: args.path })
                const reply = yield* ask({ kind: 'grep', scope, pattern: args.pattern, include: args.include, workingDirectory })
                if (!reply.ok) return yield* Effect.fail(new Error(reply.error))
                return FffSearch.grepOutcome.parse(reply.value)
              }),
              exec.signal,
            )
          },
        })

        const globTool = defineTool({
          name: 'glob',
          description: `Find files, not directories, whose paths match a glob pattern, skipping .gitignore'd files. A pattern with no "/" matches the basename at any depth. Returns up to ${FffSearch.maxGlobPaths} paths, most relevant first, and the total count.`,
          parameters: {
            pattern: { type: 'string', required: true, description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js", "*.yml").' },
            path: { type: 'string', description: 'Directory to search in. Defaults to the session workspace; a relative path resolves against it.' },
          },
          output: {
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                paths: { type: 'array', required: true, items: { type: 'string' } },
                total: { type: 'integer', required: true },
              },
            },
            render: (_args, value) => [{ type: 'text', text: FffSearch.renderGlob(value) }],
          },
          isConcurrencySafe: () => true,
          execute: (args, exec) => {
            const agent = exec.agent
            if (agent === undefined) return Promise.reject(new Error('fff-search glob runs only on behalf of an Agent'))
            return run(
              Effect.gen(function* () {
                const workingDirectory = yield* Effect.tryPromise({
                  try: () => ctx.workingDirectory.ensure(agent, exec.signal),
                  catch: error => (error instanceof Error ? error : new Error(String(error))),
                })
                const scope = yield* resolveScope({ workingDirectory, path: args.path })
                const reply = yield* ask({ kind: 'glob', scope, pattern: args.pattern, workingDirectory })
                if (!reply.ok) return yield* Effect.fail(new Error(reply.error))
                return FffSearch.globOutcome.parse(reply.value)
              }),
              exec.signal,
            )
          },
        })

        return async () => {
          offCreated()
          offDisposed()
          for (const dispose of perAgent.values()) dispose()
          perAgent.clear()
          // Snapshot before clearing the shared reference; termination may emit exit after another request creates a replacement.
          // oxlint-disable-next-line antislop/no-passthrough-variable -- Shutdown must terminate the pre-disposal worker, not a later replacement.
          const runningWorker = worker
          worker = undefined
          failPending(new Error('fff-search is unloading'))
          await runningWorker?.terminate()
          // Snapshot before clearing runtime so new tool calls fail closed while this runtime disposes asynchronously.
          // oxlint-disable-next-line antislop/no-passthrough-variable -- The captured instance is the one acquired for this plugin lifetime.
          const runningRuntime = runtime
          runtime = undefined
          await runningRuntime?.dispose()
        }
      }),
      dispose => Effect.promise(() => dispose()),
    ).pipe(Effect.map(() => undefined)),
  ),
})
