/**
 * Agent `grep` and `glob` on a resident fff index. The stock `@deepseek-ai/dsh-tool-fs-search` spawns ripgrep on every
 * call; on a loaded machine that measured 3.1 s median per DSH grep call, against a few hundred milliseconds on a warm
 * fff index (plans/fff-search). The stock tools stay registered globally: on each `agent/created` this plugin registers
 * its own through `agent.ctx`, and an Agent-scoped tool shadows the global tool of the same name. fff queries are
 * synchronous FFI calls, so the indexes live in a worker thread and the Host only posts messages.
 */
import type { Context } from '@deepseek-ai/cordis'
import '@deepseek-ai/dsh-agent'
import { dshHomePath } from '@deepseek-ai/dsh-home-paths'
import '@deepseek-ai/dsh-working-directory'
import { defineHost, defineTool } from '@dshfiles/dshx/host'
import type { z } from 'zod'
import { stat } from 'node:fs/promises'
import { Worker } from 'node:worker_threads'
import { FffSearch } from './fff-search.js'

/** Matches the stock grep's cooperative timeout; a request still pending then is failed, not left hanging. */
const REQUEST_TIMEOUT_MS = 30_000

type WorkerRequest = z.input<typeof FffSearch.workerRequest>
type WorkerReply = z.infer<typeof FffSearch.workerReply>
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never

export default defineHost({
  name: '@dshfiles/fff-search',
  inject: ['tools', 'workingDirectory'],
  setup: (ctx: Context) => {
    let worker: Worker | undefined
    let nextId = 1
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

    const ask = (request: DistributiveOmit<WorkerRequest, 'id'>): Promise<WorkerReply> =>
      new Promise((settle, reject) => {
        const id = nextId++
        const timer = setTimeout(() => {
          pending.delete(id)
          reject(new Error(`fff-search ${request.kind} did not answer within ${REQUEST_TIMEOUT_MS / 1000} s`))
        }, REQUEST_TIMEOUT_MS)
        pending.set(id, { settle, reject, timer })
        ensureWorker().postMessage({ ...request, id })
      })

    const resolveScope = async (options: { workingDirectory: string; path: string | undefined }) => {
      const target = FffSearch.target({ workingDirectory: options.workingDirectory, path: options.path })
      const found = options.path === undefined ? undefined : await stat(target).catch(() => undefined)
      return FffSearch.scope({
        workingDirectory: options.workingDirectory,
        path: options.path,
        target,
        stats: found === undefined ? undefined : { isFile: found.isFile() },
      })
    }

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
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('fff-search grep runs only on behalf of an Agent')
        const workingDirectory = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const scope = await resolveScope({ workingDirectory, path: args.path })
        const reply = await ask({ kind: 'grep', scope, pattern: args.pattern, include: args.include, workingDirectory })
        if (!reply.ok) throw new Error(reply.error)
        return FffSearch.grepOutcome.parse(reply.value)
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
      execute: async (args, exec) => {
        if (exec.agent === undefined) throw new Error('fff-search glob runs only on behalf of an Agent')
        const workingDirectory = await ctx.workingDirectory.ensure(exec.agent, exec.signal)
        const scope = await resolveScope({ workingDirectory, path: args.path })
        const reply = await ask({ kind: 'glob', scope, pattern: args.pattern, workingDirectory })
        if (!reply.ok) throw new Error(reply.error)
        return FffSearch.globOutcome.parse(reply.value)
      },
    })

    ctx.effect(() => {
      const perAgent = new Map<string, () => void>()
      const offCreated = ctx.on('agent/created', ({ agent }) => {
        perAgent.get(agent.id)?.()
        const disposeGrep = agent.ctx.tools.register(grepTool)
        const disposeGlob = agent.ctx.tools.register(globTool)
        perAgent.set(agent.id, () => {
          disposeGrep()
          disposeGlob()
        })
        // Build the index while the Agent composes its first request, so the first search finds it warm.
        void ctx.workingDirectory
          .ensure(agent)
          .then(async workingDirectory => {
            const reply = await ask({ kind: 'warm', root: workingDirectory })
            if (!reply.ok) ctx.logger.warn(`fff-search: index warm-up failed: ${reply.error}`)
          })
          .catch((error: unknown) => ctx.logger.warn(`fff-search: index warm-up failed: ${String(error)}`))
        return undefined
      })
      const offDisposed = ctx.on('agent/disposed', ({ agent }) => {
        perAgent.get(agent.id)?.()
        perAgent.delete(agent.id)
        return undefined
      })
      return () => {
        offCreated()
        offDisposed()
        for (const dispose of perAgent.values()) dispose()
        perAgent.clear()
        void worker?.terminate()
        worker = undefined
        failPending(new Error('fff-search is unloading'))
      }
    }, 'fff-search: per-Agent grep/glob and the index worker')
  },
})
