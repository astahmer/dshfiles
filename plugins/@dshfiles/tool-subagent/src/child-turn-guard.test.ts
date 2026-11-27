import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { type Agent } from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import LlmRuntime, { LlmAdapter, type GenerateOptions, type StreamChunk } from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import * as JsonlPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import SubagentRuntime, { type SubagentResult } from '@deepseek-ai/dsh-subagent'
import * as SpawnProvider from '@deepseek-ai/dsh-subagent-spawn-in-process'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as NativeToolExecutor from '@deepseek-ai/dsh-tool-executor-native'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import WorkingDirectoryService from '@deepseek-ai/dsh-working-directory'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { ChildTurnGuard, ChildTurnTracker } from './child-turn-guard.ts'
import { installChildTurnGuard } from './child-turn-guard-host.ts'
import * as tool from './native/index.ts'

const RESUME_MESSAGE = ChildTurnGuard.DEFAULT.resumeMessage
const suspended: (() => Promise<void>)[] = []

afterEach(async () => {
  for (const dispose of suspended.splice(0).reverse()) await dispose()
})

/** One scripted model answer: spoken text, or a step of tool calls, never both. */
type Reply = { readonly text: string } | { readonly toolCalls: number }

/** The only external seam: a model that answers from the test's script, never provider I/O. */
class ScriptedModel extends LlmAdapter {
  readonly requests: GenerateOptions[] = []
  constructor(private readonly answer: (request: GenerateOptions) => Reply) {
    super()
  }
  override async listModels(provider: string) {
    return [{ provider, id: 'model-a', name: 'Model A' }]
  }
  override async resolveModel(provider: string, model: string) {
    return { provider, id: model, name: model }
  }
  override async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const reply = this.answer(options)
    this.requests.push(options)
    if ('toolCalls' in reply) {
      for (let call = 0; call < reply.toolCalls; call++) {
        yield { type: 'block-start', index: call, blockType: 'tool-call' }
        yield { type: 'tool-call-delta', index: call, id: `call-${String(call)}`, name: 'probe', argumentsDelta: '{}' }
        yield { type: 'block-end', index: call, block: { type: 'tool-call', id: `call-${String(call)}`, name: 'probe', arguments: '{}' } }
      }
      yield { type: 'finish', reason: { kind: 'tool-calls' } }
      return
    }
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text: reply.text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text: reply.text } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Everything the model saw as a user prompt, so the script can answer by content. */
const promptText = (request: GenerateOptions): string =>
  request.messages.flatMap(message => (message.role === 'user' ? message.content.flatMap(block => (block.type === 'text' ? [block.text] : [])) : [])).join('\n')

/** One real Host: services, the spawn backend, the plugin under test, and a scripted parent. */
interface GuardedHost {
  readonly ctx: Context
  readonly model: ScriptedModel
  readonly parent: Agent
  readonly children: Agent[]
  /** Start one delegated child and settle it, returning its result and its durable turn log. */
  spawn(task: string): Promise<{ result: SubagentResult; child: Agent; events: readonly SessionEvent[] }>
}

const boot = async (input: {
  /** The guard config the profile row carries; the defaults when omitted. */
  readonly childTurnGuard?: Parameters<typeof tool.apply>[1]['childTurnGuard']
  /** The script for one request, given its full prompt text. */
  readonly answer: (prompt: string) => Reply
  /** Mount the package twice, as the delegation group does for `subagent` and `subagent_fork`. */
  readonly twice?: boolean
  /** Extra guard copies installed beside the row's own, to prove one stop boundary resumes once. */
  readonly extraGuards?: number
}): Promise<GuardedHost> => {
  const root = await mkdtemp(join(tmpdir(), 'child-turn-guard-'))
  const ctx = new Context()
  const model = new ScriptedModel(request => input.answer(promptText(request)))
  const children: Agent[] = []
  suspended.push(async () => {
    await ctx.fiber.dispose()
    await rm(root, { recursive: true, force: true })
  })
  for (const plugin of [SessionStore, SessionProjectionRegistry, LlmRuntime, ToolRuntime, SystemPrompt, LocalFileSystem]) await ctx.plugin(plugin)
  await ctx.plugin(JsonlPersistence, { root: join(root, 'sessions') })
  await ctx.plugin(WorkingDirectoryService, { defaultDirectory: root })
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(AgentLoop)
  await ctx.plugin(SubagentRuntime)
  await ctx.plugin({ name: 'spawn-provider', inject: ['subagents'], apply: SpawnProvider.apply }, { providerName: 'spawn' })
  await ctx.plugin(NativeToolExecutor)
  ctx.llm.registerAdapter(['scripted'], model)
  ctx.tools.register(
    defineTool({
      name: 'probe',
      description: 'Do one unit of scripted work.',
      parameters: {},
      output: {
        schema: { type: 'object', properties: { ok: { type: 'boolean' } }, additionalProperties: false },
        render: () => [{ type: 'text', text: 'ok' }],
      },
      execute: async () => ({ ok: true }),
    }),
  )
  ctx.on('agent/created', ({ agent }) => {
    children.push(agent)
  })
  const apply = (toolName: string) => {
    const config: Parameters<typeof tool.apply>[1] = { provider: 'spawn', toolName }
    if (input.childTurnGuard !== undefined) config.childTurnGuard = input.childTurnGuard
    return tool.apply(ctx, config)
  }
  await apply('subagent')
  if (input.twice === true) await apply('subagent_fork')
  for (let copy = 0; copy < (input.extraGuards ?? 0); copy++) installChildTurnGuard(ctx, input.childTurnGuard)
  const parent = await ctx.agents.create({
    sessionId: SessionId('parent-guard'),
    meta: { cwd: root },
    agentOptions: { provider: 'scripted', model: 'model-a' },
  })
  suspended.push(() => parent.dispose())
  return {
    ctx,
    model,
    parent: parent.agent,
    children,
    async spawn(task) {
      const started = await ctx.subagents.startActivation({
        provider: 'spawn',
        prompt: [{ type: 'text', text: task }],
        parent: parent.agent,
        label: 'guard test',
        signal: new AbortController().signal,
      })
      const result = await started.result
      // The parent's own turn (the completion notice) settles after the child.
      await parent.agent.whenIdle()
      const child = children.find(agent => agent.id === started.childId)
      if (child === undefined) throw new Error('the scripted child was never published')
      return { result, child, events: child.session.snapshotEvents() }
    },
  }
}

/** The user-role messages one session recorded with this text. */
const userMessages = (events: readonly SessionEvent[], text: string): readonly SessionEvent<'user/message'>[] =>
  events.flatMap(event => (event.type === 'user/message' && JSON.stringify(event.data).includes(text) ? [event] : []))

const turnStarts = (events: readonly SessionEvent[]): number => events.filter(event => event.type === 'turn/start').length

const closingOutput = (result: SubagentResult): string => result.output.flatMap(block => (block.type === 'text' ? [block.text] : [])).join('')

const HAND_BACK = 'Handoff: I cannot complete this implementation in this run; please reassign.'

describe('child turn guard decision', () => {
  it('recognizes every hand-back wording the child sessions used, and no ordinary finish', () => {
    const { patterns } = ChildTurnGuard.compile(ChildTurnGuard.DEFAULT.handBackPatterns)
    const handBacks = [
      'Incidents 1–7 remain unimplemented… Lead notified for reassignment or continuation.',
      'I cannot complete this full scope in this turn; please take over in this workspace.',
      'Incomplete: no implementation; only a plan draft was written.',
      'Handoff: unable to complete implementation in this turn… Please reassign.',
      'I cannot complete D3/D4 in this run; please reassign.',
      'no implementation yet, please reassign',
      HAND_BACK,
    ]
    for (const text of handBacks) expect([text, ChildTurnGuard.matches(text, patterns)]).toEqual([text, true])
    const finishes = ['Implemented the guard; 4 tests pass.', 'Done — committed as twqvzzpo.', 'Investigating the failure now.']
    for (const text of finishes) expect([text, ChildTurnGuard.matches(text, patterns)]).toEqual([text, false])
  })

  it('keeps usable patterns when one source is not a regular expression', () => {
    const compiled = ChildTurnGuard.compile(['reassign', '(', 'take over'])
    expect(compiled.rejected).toEqual(['('])
    expect(compiled.patterns).toHaveLength(2)
    expect(ChildTurnGuard.matches('please reassign', compiled.patterns)).toBe(true)
  })

  it('never resumes a turn that did enough work, whatever its closing text says', () => {
    const policy = ChildTurnGuard.normalize({ maxResumes: 0 })
    const { patterns } = ChildTurnGuard.compile(policy.handBackPatterns)
    const verdict = (toolCalls: number) => ChildTurnGuard.verdict({ policy, patterns, resumesUsed: 99, observation: { toolCalls, closingText: HAND_BACK } })
    expect(verdict(ChildTurnGuard.DEFAULT.minToolCalls - 1)).toBe('budget-exhausted')
    expect(verdict(ChildTurnGuard.DEFAULT.minToolCalls)).toBe('worked')
  })

  it('spends budget only on hand-backs, and lets minToolCalls 0 guard any tool count', () => {
    const anyCount = ChildTurnGuard.normalize({ minToolCalls: 0, maxResumes: 2 })
    const { patterns } = ChildTurnGuard.compile(anyCount.handBackPatterns)
    const decide = (input: { resumesUsed: number; closingText: string; toolCalls: number }) =>
      ChildTurnGuard.verdict({
        policy: anyCount,
        patterns,
        resumesUsed: input.resumesUsed,
        observation: { toolCalls: input.toolCalls, closingText: input.closingText },
      })
    expect(decide({ resumesUsed: 0, closingText: HAND_BACK, toolCalls: 8 })).toBe('resume')
    expect(decide({ resumesUsed: 1, closingText: HAND_BACK, toolCalls: 0 })).toBe('resume')
    expect(decide({ resumesUsed: 2, closingText: HAND_BACK, toolCalls: 0 })).toBe('budget-exhausted')
    expect(decide({ resumesUsed: 0, closingText: 'Eight calls done; committed.', toolCalls: 8 })).toBe('not-hand-back')
    expect(decide({ resumesUsed: 0, closingText: '   ', toolCalls: 0 })).toBe('not-hand-back')
  })

  it('keeps the defaults when the row omits the guard block', () => {
    const omitted = tool.Config({ provider: 'spawn' })
    expect(omitted.childTurnGuard).toBeUndefined()
    expect(ChildTurnGuard.normalize(omitted.childTurnGuard)).toEqual(ChildTurnGuard.DEFAULT)
    // An omitted pattern list must stay omitted: materialized as `[]` it would match nothing.
    const partial = tool.Config({ provider: 'spawn', childTurnGuard: { maxResumes: 1 } })
    expect(partial.childTurnGuard?.handBackPatterns).toBeUndefined()
    expect(ChildTurnGuard.normalize(partial.childTurnGuard).handBackPatterns).toEqual(ChildTurnGuard.DEFAULT.handBackPatterns)
  })

  it('normalizes a partial row without trusting nonsense values', () => {
    expect(ChildTurnGuard.normalize(undefined)).toEqual(ChildTurnGuard.DEFAULT)
    expect(ChildTurnGuard.normalize({ enabled: false })).toEqual({ ...ChildTurnGuard.DEFAULT, enabled: false })
    const clamped = ChildTurnGuard.normalize({ minToolCalls: -4, maxResumes: 1.5 })
    expect(clamped.minToolCalls).toBe(ChildTurnGuard.DEFAULT.minToolCalls)
    expect(clamped.maxResumes).toBe(ChildTurnGuard.DEFAULT.maxResumes)
    expect(ChildTurnGuard.normalize({ handBackPatterns: [] }).handBackPatterns).toEqual([])
  })

  it('reads work and closing text from the turn events, replacing the text the turn continues', () => {
    const tracker = new ChildTurnTracker()
    expect(tracker.observation(1)).toBeUndefined()
    tracker.turnStarted(1)
    tracker.toolCalled(1)
    tracker.assistantSpoke(1, HAND_BACK)
    tracker.assistantSpoke(1, 'Implemented the next step.')
    tracker.toolCalled(1)
    expect(tracker.observation(1)).toEqual({ toolCalls: 2, closingText: 'Implemented the next step.' })
    expect(tracker.observation(2)).toBeUndefined()
    tracker.turnStarted(2)
    expect(tracker.observation(2)).toEqual({ toolCalls: 0, closingText: '' })
  })
})

describe('child turn guard in a scripted child', () => {
  it('resumes a child that hands the task back, instead of reporting its hand-back as the result', async () => {
    const host = await boot({
      answer: prompt =>
        prompt.includes(RESUME_MESSAGE)
          ? { text: 'Implemented the next step.' }
          : prompt.includes('Implement the guard task')
            ? { text: HAND_BACK }
            : { text: 'Parent noted the result.' },
    })
    const { result, events } = await host.spawn('Implement the guard task.')
    expect(closingOutput(result)).toBe('Implemented the next step.')
    expect(result.stopReason).toBe('completed')
    // The resume continues the same turn: one turn/start, one continuing message.
    expect(turnStarts(events)).toBe(1)
    expect(userMessages(events, RESUME_MESSAGE)).toHaveLength(1)
    expect(host.model.requests.filter(request => promptText(request).includes(RESUME_MESSAGE))).toHaveLength(1)
  })

  it('stops resuming after the budget and tells the parent the closing answer is a hand-back', async () => {
    // Both delegation tool instances and a second guard copy watch the same child.
    const host = await boot({
      twice: true,
      extraGuards: 1,
      answer: prompt =>
        prompt.includes(RESUME_MESSAGE) || prompt.includes('Implement the guard task') ? { text: HAND_BACK } : { text: 'Parent noted the result.' },
    })
    const { result, events, child } = await host.spawn('Implement the guard task.')
    expect(turnStarts(events)).toBe(1)
    expect(userMessages(events, RESUME_MESSAGE)).toHaveLength(2)
    expect(closingOutput(result)).toBe(HAND_BACK)
    expect(result.stopReason).toBe('completed')
    const parentEvents = host.parent.session.snapshotEvents()
    expect(userMessages(parentEvents, 'stopped without implementing after 2 resume attempt(s)')).toHaveLength(1)
    // The completion notice still reaches the parent, with the child's own closing text.
    expect(userMessages(parentEvents, HAND_BACK).length).toBeGreaterThanOrEqual(1)
    expect(child.status).toBe('idle')
  })

  it('never touches a busy turn whose closing text happens to read like a hand-back', async () => {
    let childSteps = 0
    const host = await boot({
      answer: prompt => {
        if (prompt.includes(RESUME_MESSAGE)) return { text: 'Implemented the next step.' }
        if (!prompt.includes('Implement the guard task')) return { text: 'Parent noted the result.' }
        childSteps += 1
        return childSteps === 1 ? { toolCalls: ChildTurnGuard.DEFAULT.minToolCalls } : { text: HAND_BACK }
      },
    })
    const { result, events } = await host.spawn('Implement the guard task.')
    // Three tool calls make the turn work, so its closing wording is never resumed.
    expect(closingOutput(result)).toBe(HAND_BACK)
    expect(userMessages(events, RESUME_MESSAGE)).toHaveLength(0)
  })

  it('never resumes a normal finish', async () => {
    const host = await boot({
      answer: prompt => {
        if (prompt.includes(RESUME_MESSAGE)) return { text: 'Implemented the next step.' }
        return prompt.includes('Implement the guard task') ? { text: 'Added the guard test; the suite passes.' } : { text: 'Parent noted the result.' }
      },
    })
    const { result, events } = await host.spawn('Implement the guard task.')
    expect(closingOutput(result)).toBe('Added the guard test; the suite passes.')
    expect(turnStarts(events)).toBe(1)
    expect(userMessages(events, RESUME_MESSAGE)).toHaveLength(0)
    expect(userMessages(host.parent.session.snapshotEvents(), 'stopped without implementing')).toHaveLength(0)
  })

  it('stays off when the row switches it off', async () => {
    const host = await boot({
      childTurnGuard: { enabled: false },
      answer: prompt => (prompt.includes('Implement the guard task') ? { text: HAND_BACK } : { text: 'Parent noted the result.' }),
    })
    const { result, events } = await host.spawn('Implement the guard task.')
    expect(closingOutput(result)).toBe(HAND_BACK)
    expect(userMessages(events, RESUME_MESSAGE)).toHaveLength(0)
  })
})
