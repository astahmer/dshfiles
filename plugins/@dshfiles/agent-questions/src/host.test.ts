import Storage from '@deepseek-ai/dsh-storage'
import * as StorageDomainPlugin from '@deepseek-ai/dsh-storage-domain'
import * as StorageJson from '@deepseek-ai/dsh-storage-json'
import { createTestHost } from '@dshfiles/dshx/testing'
import { describe, expect, it } from '@effect/vitest'
import { Effect, Fiber, Schedule, Schema } from 'effect'
import plugin from './host.js'
import { AgentQuestionsTesting } from './test-support.js'

interface TestAgent {
  readonly id: string
  readonly session: { readonly header: { readonly cwd: string } }
}

const definitionSchema = Schema.Struct({
  tools: Schema.Array(
    Schema.Struct({
      name: Schema.String,
      parameters: Schema.Struct({ type: Schema.Literal('object'), properties: Schema.Record(Schema.String, Schema.Unknown) }),
      execute: Schema.declare((value): value is (args: unknown, execution: unknown) => Promise<unknown> => typeof value === 'function'),
    }),
  ),
})
const definition = Schema.decodeUnknownSync(definitionSchema)(plugin)

const runTool = (input: { readonly name: string; readonly args: unknown; readonly agent: TestAgent; readonly callId: string }) => {
  const tool = definition.tools.find(candidate => candidate.name === input.name)
  if (tool === undefined) return Effect.die(new Error(`No tool ${input.name}.`))
  return Effect.tryPromise({
    try: signal => tool.execute(input.args, { callId: input.callId, agent: input.agent, signal }),
    catch: error => (error instanceof Error ? error : new Error('The tool failed without an Error.')),
  })
}

/** The plugin mounted on a test Host with real JSON storage and a two-Agent graph standing in for the agent services. */
const mountedQuestions = Effect.gen(function* () {
  const workspace = yield* AgentQuestionsTesting.temporaryDirectory('agent-questions-host-')
  const root: TestAgent = { id: 'root-session', session: { header: { cwd: workspace } } }
  const child: TestAgent = { id: 'child-session', session: { header: { cwd: workspace } } }
  const agents = new Map([
    [root.id, root],
    [child.id, child],
  ])
  const parentOf = new Map([[child.id, root.id]])
  const parentNotices: string[] = []
  const host = yield* Effect.acquireRelease(
    Effect.promise(() => createTestHost()),
    created => Effect.promise(() => created.dispose()),
  )
  const services = {
    agents: {
      get: (id: string) => agents.get(id),
      roots: () => [root],
      isOwnedBy: (childId: string, parent: TestAgent) => parentOf.get(childId) === parent.id,
    },
    sessions: {
      list: () => [...agents.values()],
      get: (id: string) => (agents.has(id) ? { header: { cwd: workspace, parentSession: parentOf.get(id) } } : undefined),
    },
    sessionProjections: { register: () => () => undefined },
    sessionQuery: { listSessions: async () => [], observeSession: async () => Promise.reject(new Error('no session log in this test')) },
    subagents: {
      sendMessage: async (_from: TestAgent, _to: string, content: ReadonlyArray<{ readonly text: string }>) => {
        parentNotices.push(content.map(part => part.text).join('\n'))
        return `message-${String(parentNotices.length)}`
      },
    },
    userQuestions: { answer: () => false },
  }
  for (const [name, service] of Object.entries(services)) {
    // SAFETY: each stand-in implements only the members the agent-questions edge calls on that Host service.
    const release = host.ctx.provide(name as never, service as never)
    yield* Effect.addFinalizer(() => Effect.sync(release))
  }
  yield* Effect.promise(async () => {
    await host.ctx.plugin(Storage)
    await host.ctx.plugin(StorageJson, { root: `${workspace}/storage` })
    await host.ctx.plugin(StorageDomainPlugin, { backend: 'json' })
  })
  yield* Effect.promise(() => host.mount(plugin, { packageId: '@dshfiles/agent-questions' }))
  return { root, child, parentNotices }
})

const resultText = (result: unknown): string => (typeof result === 'string' ? result : JSON.stringify(result))

describe('agent-questions Host tools', () => {
  it('publishes every tool with an object parameter schema', () => {
    expect(definition.tools.map(tool => tool.name)).toEqual([
      'ask_parent_question',
      'answer_parent_question',
      'list_thread_questions',
      'answer_thread_question',
      'submit_markdown_feedback',
      'resolve_parent_feedback',
      'get_parent_feedback',
      'cancel_parent_feedback',
    ])
    expect(Object.keys(definition.tools[0]?.parameters.properties ?? {})).toEqual([
      'question',
      'questionId',
      'context',
      'options',
      'recommendedOptionId',
      'expiryBehavior',
      'timeoutMs',
    ])
  })

  it.live('lets a child ask, the parent list and answer, and the child read the answer', () =>
    Effect.gen(function* () {
      const { root, child, parentNotices } = yield* mountedQuestions
      const asking = yield* Effect.forkChild(
        runTool({
          name: 'ask_parent_question',
          callId: 'ask-1',
          agent: child,
          args: {
            question: 'Which migration strategy should I use?',
            options: [
              { id: 'expand', label: 'Expand and contract' },
              { id: 'direct', label: 'Replace directly' },
            ],
            recommendedOptionId: 'expand',
            expiryBehavior: 'recommended',
          },
        }),
      )
      const listed = yield* runTool({ name: 'list_thread_questions', callId: 'list-1', agent: root, args: {} }).pipe(
        Effect.repeat({ schedule: Schedule.spaced('10 millis'), until: result => resultText(result).includes('"questionId"'), times: 50 }),
      )
      const questionId = /"questionId":"([0-9a-f-]{36})"/.exec(resultText(listed))?.[1] ?? ''
      expect(parentNotices[0]).toContain(`Parent question ${questionId}`)

      const refused = yield* Effect.flip(runTool({ name: 'answer_parent_question', callId: 'answer-0', agent: child, args: { questionId, answer: 'Mine.' } }))
      expect(refused.message).toBe('Only the direct parent can answer this question.')
      const answered = yield* runTool({ name: 'answer_parent_question', callId: 'answer-1', agent: root, args: { questionId, answer: 'Expand.' } })
      expect(resultText(answered)).toContain(`Answer delivered to child question ${questionId}.`)
      expect(resultText(yield* Fiber.join(asking))).toContain(`Parent answer for ${questionId}`)
    }),
  )
})
