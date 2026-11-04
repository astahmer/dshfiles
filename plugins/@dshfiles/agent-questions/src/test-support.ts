import { createHash } from 'node:crypto'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { HostContext } from '@dshfiles/dshx/effect'
import { StorageDomain } from '@dshfiles/dshx/effect/storage-domain'
import { NodeServices } from '@effect/platform-node'
import { Effect, FileSystem, Layer, Path } from 'effect'
import { AgentDirectory, type LiveAgent } from './agent-host-promise.js'
import { NotificationFailed, ParentUnavailable } from './errors.js'
import { MarkdownDocuments } from './markdown-documents.js'
import { ParentFeedback } from './parent-feedback.js'
import { ParentQuestions } from './parent-questions.js'
import { QuestionStore } from './question-store.js'

/** A real Cordis context with the JSON storage domain backend, rooted in `root` and disposed with the layer. */
const jsonStorageHost = (root: string) =>
  Layer.effect(
    HostContext,
    Effect.acquireRelease(
      Effect.promise(async () => {
        const ctx = new CordisContext()
        await ctx.plugin(Storage)
        await ctx.plugin(StorageJson, { root })
        await ctx.plugin(StorageDomainPlugin, { backend: 'json' })
        return ctx
      }),
      ctx => Effect.promise(() => ctx.fiber.dispose()),
    ).pipe(Effect.map(ctx => HostContext.of({ ctx, packageId: '@dshfiles/agent-questions' }))),
  )

/** The Agents of one test: who is live, who is whose parent, where each works, and every notice delivered. */
export interface AgentWorld {
  readonly live: Map<string, LiveAgent>
  readonly parents: Map<string, string>
  readonly workspaces: Map<string, string>
  readonly parentNotices: string[]
  readonly childNotices: string[]
  failParentDelivery: boolean
}

const makeWorld = (input: { readonly agents: ReadonlyArray<LiveAgent>; readonly parents: ReadonlyArray<readonly [string, string]> }): AgentWorld => ({
  live: new Map(input.agents.map(agent => [agent.id, agent])),
  parents: new Map(input.parents),
  workspaces: new Map(),
  parentNotices: [],
  childNotices: [],
  failParentDelivery: false,
})

/** The Host's agent graph stands in for the DSH agents/subagents services, which a unit test does not run. */
const fakeAgentDirectory = (world: AgentWorld) =>
  Layer.succeed(
    AgentDirectory,
    AgentDirectory.of({
      isLive: agent => world.live.get(agent.id) === agent,
      parentSessionId: childSessionId => world.parents.get(childSessionId),
      isDirectChild: (childSessionId, parentSessionId) =>
        world.live.has(childSessionId) && world.live.has(parentSessionId) && world.parents.get(childSessionId) === parentSessionId,
      workspaceOf: sessionId => Effect.succeed(world.workspaces.get(sessionId)),
      notifyParent: input =>
        Effect.suspend((): Effect.Effect<string, NotificationFailed | ParentUnavailable> => {
          if (world.failParentDelivery) return Effect.fail(new NotificationFailed())
          if (!world.live.has(input.parentSessionId)) return Effect.fail(new ParentUnavailable({ subject: input.subject }))
          world.parentNotices.push(input.text)
          return Effect.succeed(`parent-message-${String(world.parentNotices.length)}`)
        }),
      notifyChild: input =>
        Effect.suspend((): Effect.Effect<void, ParentUnavailable> => {
          if (!world.live.has(input.parentSessionId) || world.parents.get(input.childSessionId) !== input.parentSessionId) {
            return Effect.fail(new ParentUnavailable({ subject: 'resolution' }))
          }
          world.childNotices.push(input.text)
          return Effect.void
        }),
    }),
  )

/** The question and feedback services over real JSON storage in `root`, with the store exposed for assertions. */
const questionServices = (input: { readonly root: string; readonly world: AgentWorld }) =>
  Layer.mergeAll(ParentQuestions.layer, ParentFeedback.layer).pipe(
    Layer.provideMerge(QuestionStore.layer),
    Layer.provide(StorageDomain.layer),
    Layer.provide(jsonStorageHost(input.root)),
    Layer.provide(Layer.mergeAll(fakeAgentDirectory(input.world), MarkdownDocuments.layer.pipe(Layer.provide(NodeServices.layer)))),
  )

/** A temporary directory removed when the test's Scope closes. */
const temporaryDirectory = (prefix: string) =>
  Effect.flatMap(FileSystem.FileSystem, fs => fs.makeTempDirectoryScoped({ prefix })).pipe(Effect.provide(NodeServices.layer))

/** Write `relativePath` under `workspace` and return the whole-file revision feedback anchors to. */
const writeWorkspaceFile = (input: { readonly workspace: string; readonly relativePath: string; readonly contents: string }) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const target = path.join(input.workspace, input.relativePath)
    yield* fs.makeDirectory(path.dirname(target), { recursive: true })
    yield* fs.writeFileString(target, input.contents)
    return createHash('sha256').update(input.contents).digest('hex')
  }).pipe(Effect.provide(NodeServices.layer))

/** Real layers and stand-ins shared by the agent-questions tests. */
export class AgentQuestionsTesting {
  static readonly jsonStorageHost = jsonStorageHost
  static readonly makeWorld = makeWorld
  static readonly questionServices = questionServices
  static readonly temporaryDirectory = temporaryDirectory
  static readonly writeWorkspaceFile = writeWorkspaceFile
}
