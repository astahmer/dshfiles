/**
 * Agent `grep` and `glob` on a resident fff index. The stock `@deepseek-ai/dsh-tool-fs-search` spawns ripgrep on every
 * call; on a loaded machine that measured 3.1 s median per DSH grep call, against a few hundred milliseconds on a warm
 * fff index (plans/fff-search). The stock tools stay registered globally: on each `agent/created` this plugin registers
 * its own through `agent.ctx`, and an Agent-scoped tool shadows the global tool of the same name.
 */
import '@deepseek-ai/dsh-agent'
import { DshxPlugin, HostEvents, Tool } from '@dshfiles/dshx/effect'
import { layer as nodeFileSystemLayer } from '@effect/platform-node/NodeFileSystem'
import { Effect, FiberMap, FileSystem, Layer, Option, Schema } from 'effect'
import { FffIndexWorker } from './fff-index-worker-promise.js'
import { FffSearch, FffSearchError } from './fff-search.js'
import { WorkingDirectories } from './working-directory-promise.js'

const decodeGrepOutcome = Schema.decodeUnknownEffect(FffSearch.grepOutcome)
const decodeGlobOutcome = Schema.decodeUnknownEffect(FffSearch.globOutcome)
const isFffSearchError = Schema.is(FffSearchError)

const pathDescription = (what: string) => `${what} Defaults to the session workspace; a relative path resolves against it.`

const grepInput = Schema.Struct({
  pattern: Schema.String.annotate({ description: 'Regular expression to search for.' }),
  path: Schema.optionalKey(Schema.String.annotate({ description: pathDescription('File or directory to search.') })),
  include: Schema.optionalKey(
    Schema.String.annotate({ description: 'One glob filter for which files to search (e.g. "*.ts", "*.{js,jsx}"). Not a list; negation is not supported.' }),
  ),
})

const globInput = Schema.Struct({
  pattern: Schema.String.annotate({ description: 'Glob pattern to match file paths against (e.g. "**/*.ts", "src/**/*.test.js", "*.yml").' }),
  path: Schema.optionalKey(Schema.String.annotate({ description: pathDescription('Directory to search in.') })),
})

/** The Agent's workspace, and the index root plus narrowing the optional `path` resolves to. */
const searchScope = Effect.fnUntraced(function* (call: Tool.ToolCall, tool: string, path: string | undefined) {
  const agent = call.agent
  if (agent === undefined) return yield* new FffSearchError({ reason: `fff-search ${tool} runs only on behalf of an Agent` })
  const workingDirectory = yield* WorkingDirectories.use(directories => directories.ensure(agent))
  const fs = yield* FileSystem.FileSystem
  const target = FffSearch.target({ workingDirectory, path })
  const info = path === undefined ? Option.none() : yield* fs.stat(target).pipe(Effect.option)
  const scope = yield* Effect.try({
    try: () =>
      FffSearch.scope({ workingDirectory, path, target, stats: Option.getOrUndefined(Option.map(info, found => ({ isFile: found.type === 'File' }))) }),
    catch: cause => (isFffSearchError(cause) ? cause : new FffSearchError({ reason: `fff-search could not resolve ${path ?? 'the workspace'}`, cause })),
  })
  return { workingDirectory, scope }
})

const grepTool = Tool.make({
  name: 'grep',
  description: `Search file contents with a regular expression (Rust regex syntax, like ripgrep) over an indexed, .gitignore-aware view of the workspace. Returns matching lines with line numbers, grouped by file, most relevant files first. Returns up to ${FffSearch.maxGrepMatches} matches and the total count.`,
  input: grepInput,
  output: FffSearch.grepOutcome,
  readOnly: true,
  render: FffSearch.renderGrep,
  execute: (input, call) =>
    Effect.gen(function* () {
      const { workingDirectory, scope } = yield* searchScope(call, 'grep', input.path)
      const reply = yield* FffIndexWorker.use(worker =>
        worker.ask(
          input.include === undefined
            ? { kind: 'grep', scope, pattern: input.pattern, workingDirectory }
            : { kind: 'grep', scope, pattern: input.pattern, include: input.include, workingDirectory },
        ),
      )
      return yield* decodeGrepOutcome(reply).pipe(Effect.orDie)
    }),
})

const globTool = Tool.make({
  name: 'glob',
  description: `Find files, not directories, whose paths match a glob pattern, skipping .gitignore'd files. A pattern with no "/" matches the basename at any depth. Returns up to ${FffSearch.maxGlobPaths} paths, most relevant first, and the total count.`,
  input: globInput,
  output: FffSearch.globOutcome,
  readOnly: true,
  render: FffSearch.renderGlob,
  execute: (input, call) =>
    Effect.gen(function* () {
      const { workingDirectory, scope } = yield* searchScope(call, 'glob', input.path)
      const reply = yield* FffIndexWorker.use(worker => worker.ask({ kind: 'glob', scope, pattern: input.pattern, workingDirectory }))
      return yield* decodeGlobOutcome(reply).pipe(Effect.orDie)
    }),
})

/**
 * Each Agent gets its own grep and glob for as long as it lives, and its index is built while it composes its first
 * request so the first search finds it warm. One fiber per Agent holds the registrations; disposal interrupts it.
 */
const agentTools = Layer.effectDiscard(
  Effect.gen(function* () {
    const agents = yield* FiberMap.make<string>()
    yield* HostEvents.on('agent/created', ({ agent }) =>
      FiberMap.run(
        agents,
        agent.id,
        Effect.gen(function* () {
          yield* Tool.register(grepTool, { tools: agent.ctx.tools })
          yield* Tool.register(globTool, { tools: agent.ctx.tools })
          const root = yield* WorkingDirectories.use(directories => directories.ensure(agent))
          yield* FffIndexWorker.use(worker => worker.ask({ kind: 'warm', root }))
        }).pipe(
          Effect.catch(error => Effect.logWarning('fff-search: index warm-up failed', error)),
          Effect.andThen(Effect.never),
          Effect.scoped,
        ),
      ).pipe(Effect.asVoid),
    )
    yield* HostEvents.on('agent/disposed', ({ agent }) => FiberMap.remove(agents, agent.id))
  }),
)

export default DshxPlugin.make({
  name: '@dshfiles/fff-search',
  inject: ['tools', 'workingDirectory'],
  layer: agentTools.pipe(Layer.provideMerge(Layer.mergeAll(FffIndexWorker.layer, WorkingDirectories.layer, nodeFileSystemLayer))),
})
