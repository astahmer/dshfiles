import { Context } from '@deepseek-ai/cordis'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import { ToolResultPruner } from '@deepseek-ai/dsh-compaction-tool-result-pruner'
import {
  CONTEXT_WINDOW_EXCEEDED_CODE,
  createUserMessage,
  LlmAdapter,
  ToolCallId,
  LlmRuntime,
  type ContentBlock,
  type GenerateOptions,
  type LlmResolvedModelInfo,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { SessionStore } from '@deepseek-ai/dsh-session'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection'
import TokenMeter from '@deepseek-ai/dsh-token-meter'
import { createTestHost } from '@dshfiles/dshx/testing'
import { Schema } from 'effect'
import { readFileSync } from 'node:fs'
import plugin from '../../src/host.js'

/** A user input: its text size, attached images and the source kind DSH recorded. */
const UserEvent = Schema.Tuple([Schema.Literal('u'), Schema.Number, Schema.Number, Schema.String])
type UserEvent = typeof UserEvent.Type
/** One recorded tool call: name, argument chars, result chars, result images, error flag, loaded skill name. */
const RecordedCall = Schema.Tuple([Schema.String, Schema.Number, Schema.Number, Schema.Number, Schema.Number, Schema.NullOr(Schema.String)])
/** One recorded model step: text chars, reasoning chars, its tool calls. */
const StepEvent = Schema.Tuple([Schema.Literal('a'), Schema.Number, Schema.Number, Schema.Array(RecordedCall)])
type StepEvent = typeof StepEvent.Type

/** A shape-only replay of one recorded thread, written by `scripts/replay-workload.mjs`. */
const Workload = Schema.Struct({
  name: Schema.String,
  kind: Schema.String,
  source: Schema.String,
  route: Schema.Struct({ provider: Schema.String, model: Schema.String, contextWindow: Schema.Number }),
  systemChars: Schema.Number,
  tools: Schema.Array(Schema.Tuple([Schema.String, Schema.Number])),
  events: Schema.Array(Schema.Union([UserEvent, StepEvent])),
})
export type Workload = typeof Workload.Type

/**
 * A: both engines automatic (the web seed today). B: the stock preset row with `auto: false`. C: no stock row, the root
 * pruner row on. D: A plus the root pruner row, so the owned engine prunes too and the stock row stays the fallback.
 */
export type EngineSetup = 'A' | 'B' | 'C' | 'D'
export type LoadedSkills = 'off' | 'names'

interface ReplayOptions {
  readonly workload: Workload
  readonly setup: EngineSetup
  readonly loadedSkills: LoadedSkills
  /** The routed output reservation: gpt-6-luna's default is 32,000 tokens (its live threshold is 174,464 of 272,000). */
  readonly defaultMaxTokens: number
}

/** Chars per token for the replay's own request pricing; images use a flat visual cost. */
const CHARS_PER_TOKEN = 4
const IMAGE_TOKENS = 1_600
/** Median recorded checkpoint summary length across six long threads (4,668 to 5,498 chars). */
const SUMMARY_CHARS = 5_200
const RECENT_RESULTS = 10
const PRUNE_MARKER = '[... tool result middle pruned ...]'
const SKILL_NAME = /<skill_content name="([^"]+)">/g
const KEPT_SKILLS = /<loaded-skills>([\s\S]*?)<\/loaded-skills>/g
const LISTED_SKILL = /^- (\S+)/gm

/** The profile rows' pruner budgets (`profiles/web/cordis.patch.yml` and the stock root row). */
const PRUNER_CONFIG = { thresholdChars: 8192, headChars: 4096, tailChars: 1024 }

const WORDS = ['alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot', 'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima']
/** Deterministic text of exactly `chars` characters, opened by a tag the survival checks look for. */
const filler = (chars: number, tag: string) => {
  const head = `[${tag}] `
  if (chars <= head.length) return head.slice(0, Math.max(1, chars))
  const parts = [head]
  let length = head.length
  for (let index = 0; length < chars; index += 1) {
    const word = `${WORDS[index % WORDS.length] ?? 'x'}${String(index)} `
    parts.push(word)
    length += word.length
  }
  return parts.join('').slice(0, chars)
}

/** Recorded tool names, prefixed so they never collide with a tool the test Host registers itself. */
const replayToolName = (name: string) => `replay_${name}`

export const loadWorkload = (name: string): Workload =>
  Schema.decodeUnknownSync(Schema.fromJsonString(Workload))(readFileSync(new URL(`../fixtures/replay/${name}.json`, import.meta.url), 'utf8'))

const textOf = (blocks: readonly ContentBlock[]) =>
  blocks.map(block => (block.type === 'text' || block.type === 'reasoning' ? block.text : block.type === 'tool-call' ? block.arguments : '')).join('')

type RequestMessage = GenerateOptions['messages'][number]

const messageKey = (message: RequestMessage) =>
  JSON.stringify(message.content.map(block => (block.type === 'image' ? { image: block.attachment.attachmentId } : block)))

const messageTokens = (message: RequestMessage) =>
  message.content.reduce((sum, block) => sum + (block.type === 'image' ? IMAGE_TOKENS : Math.ceil(JSON.stringify(block).length / CHARS_PER_TOKEN)), 4)

interface RequestPrice {
  readonly total: number
  readonly prefix: number
  readonly keys: readonly string[]
  readonly perMessage: readonly number[]
}

const priceRequest = (options: GenerateOptions): RequestPrice => {
  const prefix = Math.ceil((JSON.stringify(options.system ?? '').length + JSON.stringify(options.tools ?? []).length) / CHARS_PER_TOKEN)
  const perMessage = options.messages.map(messageTokens)
  return { prefix, perMessage, keys: options.messages.map(messageKey), total: prefix + perMessage.reduce((sum, value) => sum + value, 0) }
}

/** What the next request still shows, right after one checkpoint. */
export interface CheckpointSurvival {
  readonly skillsLoaded: number
  readonly skillsVisible: number
  readonly recentResults: number
  readonly recentResultsVisible: number
  readonly recentResultsWhole: number
  readonly todoVisible: boolean | null
}

export interface ReplayResult {
  readonly scenario: string
  readonly setup: EngineSetup
  readonly loadedSkills: LoadedSkills
  readonly agentRequests: number
  readonly compactionsStarted: number
  readonly compactionsSucceeded: number
  readonly compactionsFailed: number
  /** Successful checkpoints by engine: ours runs with maxTokens 8,192, the stock preset row with its default 65,536. */
  readonly checkpointsByOurs: number
  readonly checkpointsByStock: number
  readonly prunedResults: number
  readonly failureReasons: Readonly<Record<string, number>>
  readonly peakRequestTokens: number
  readonly totalRequestTokens: number
  /** Share of request tokens that repeat the previous request's prefix: the provider prompt-cache proxy. */
  readonly prefixReuse: number
  readonly summaryRequests: number
  readonly summaryInputTokens: number
  readonly overflows: number
  readonly failedTurns: number
  /** Recorded steps dropped because no request of their turn fit the window. */
  readonly skippedSteps: number
  readonly compactionWallMs: readonly number[]
  readonly survival: readonly CheckpointSurvival[]
  readonly replayMs: number
}

/** Serves the recorded steps in order and prices every request; answers every summary request with a fixed-size summary. */
class ReplayAdapter extends LlmAdapter {
  cursor = 0
  agentRequests = 0
  overflows = 0
  summaryRequests = 0
  summaryInputTokens = 0
  peak = 0
  total = 0
  reused = 0
  private previous: RequestPrice | undefined
  private nextCall = 0
  readonly results = new Map<string, { readonly text: string; readonly images: number; readonly skill: string | null }>()
  private image = 0

  /** A distinct image reference sized like a typical recorded screenshot. */
  nextImage(): ContentBlock {
    this.image += 1
    // SAFETY: a well-formed sha256 attachment id; its AttachmentId brand lives in @deepseek-ai/dsh-attachment, which this
    // package does not depend on, and nothing in the replay resolves the attachment.
    return {
      type: 'image',
      attachment: { attachmentId: `sha256:${String(this.image).padStart(64, '0')}`, mediaType: 'image/webp', width: 1600, height: 1000, bytes: 200_000 },
    } as ContentBlock
  }

  /** Tags of tool results in delivery order, with the skill each one loaded. */
  readonly delivered: { readonly tag: string; readonly skill: string | null; readonly todo: boolean }[] = []
  checkpointPending = false
  readonly survival: CheckpointSurvival[] = []

  constructor(
    private readonly workload: Workload,
    private readonly contextWindow: number,
    private readonly defaultMaxTokens: number,
  ) {
    super()
  }

  override resolveModel(provider: string, model: string): Promise<LlmResolvedModelInfo> {
    return Promise.resolve({ provider, id: model, name: model, context: { contextWindow: this.contextWindow }, defaultMaxTokens: this.defaultMaxTokens })
  }

  async *stream(options: GenerateOptions): AsyncIterable<StreamChunk> {
    const price = priceRequest(options)
    if (options.purpose === 'compaction') {
      this.summaryRequests += 1
      this.summaryInputTokens += price.total
      if (price.total > this.contextWindow) {
        yield overflow(price.total, this.contextWindow)
        return
      }
      yield* textChunks(filler(SUMMARY_CHARS, `summary-${String(this.summaryRequests)}`))
      return
    }
    this.agentRequests += 1
    if (price.total > this.contextWindow) {
      this.overflows += 1
      yield overflow(price.total, this.contextWindow)
      return
    }
    this.record(price, options)
    const step = this.workload.events[this.cursor]
    if (step === undefined || step[0] === 'u') {
      yield* textChunks('ok')
      return
    }
    this.cursor += 1
    yield* this.stepChunks(step)
  }

  private record(price: RequestPrice, options: GenerateOptions) {
    this.peak = Math.max(this.peak, price.total)
    this.total += price.total
    const previous = this.previous
    if (previous !== undefined && previous.prefix === price.prefix) {
      let reused = price.prefix
      for (let index = 0; index < Math.min(previous.keys.length, price.keys.length) && previous.keys[index] === price.keys[index]; index += 1)
        reused += price.perMessage[index] ?? 0
      this.reused += reused
    }
    this.previous = price
    if (!this.checkpointPending) return
    this.checkpointPending = false
    this.survival.push(this.survivalIn(options.messages))
  }

  private survivalIn(messages: readonly RequestMessage[]): CheckpointSurvival {
    const text = messages.map(message => textOf(message.content)).join('\n')
    const loaded = new Set(this.delivered.flatMap(result => (result.skill === null ? [] : [result.skill])))
    const visible = new Set([...text.matchAll(SKILL_NAME)].map(match => match[1]))
    for (const block of text.matchAll(KEPT_SKILLS)) for (const listed of (block[1] ?? '').matchAll(LISTED_SKILL)) visible.add(listed[1])
    const recent = this.delivered.slice(-RECENT_RESULTS)
    const lastTodo = this.delivered.findLast(result => result.todo)
    const shown = (tag: string) => text.includes(`[${tag}] `)
    const whole = (tag: string) => {
      const start = text.indexOf(`[${tag}] `)
      return start >= 0 && !text.slice(start, start + PRUNER_CONFIG.headChars + 64).includes(PRUNE_MARKER)
    }
    return {
      skillsLoaded: loaded.size,
      skillsVisible: [...loaded].filter(skill => visible.has(skill)).length,
      recentResults: recent.length,
      recentResultsVisible: recent.filter(result => shown(result.tag)).length,
      recentResultsWhole: recent.filter(result => whole(result.tag)).length,
      todoVisible: lastTodo === undefined ? null : shown(`${lastTodo.tag}-args`),
    }
  }

  private *stepChunks(step: StepEvent): Iterable<StreamChunk> {
    let index = 0
    const block = (type: 'text' | 'reasoning', text: string): StreamChunk[] => {
      const chunks: StreamChunk[] = [
        { type: 'block-start', index, blockType: type },
        type === 'text' ? { type: 'text-delta', index, text } : { type: 'reasoning-delta', index, text },
        { type: 'block-end', index, block: { type, text } },
      ]
      index += 1
      return chunks
    }
    if (step[2] > 0) yield* block('reasoning', filler(step[2], 'reasoning'))
    if (step[1] > 0) yield* block('text', filler(step[1], 'text'))
    for (const [name, argChars, resultChars, images, , skill] of step[3]) {
      this.nextCall += 1
      const id = ToolCallId(`call-${String(this.nextCall)}`)
      const tag = `r${String(this.nextCall)}`
      const argumentsJson = JSON.stringify({ input: filler(Math.max(1, argChars - 12), `${tag}-args`) })
      const body =
        skill === null
          ? filler(resultChars, tag)
          : `<skill_content name="${skill}">\nBase directory for this skill: /skills/${skill}\n${filler(Math.max(1, resultChars - 80 - skill.length * 2), tag)}\n</skill_content>`
      this.results.set(id, { text: body, images, skill })
      this.delivered.push({ tag, skill, todo: name === 'todo_write' })
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, name: replayToolName(name), argumentsDelta: argumentsJson }
      yield { type: 'block-end', index, block: { type: 'tool-call', id, name: replayToolName(name), arguments: argumentsJson } }
      index += 1
    }
    yield { type: 'finish', reason: step[3].length > 0 ? { kind: 'tool-calls' } : { kind: 'stop' } }
  }
}

const textChunks = function* (text: string): Iterable<StreamChunk> {
  yield { type: 'block-start', index: 0, blockType: 'text' }
  yield { type: 'text-delta', index: 0, text }
  yield { type: 'block-end', index: 0, block: { type: 'text', text } }
  yield { type: 'finish', reason: { kind: 'stop' } }
}

const overflow = (tokens: number, window: number): StreamChunk => ({
  type: 'finish',
  reason: {
    kind: 'error',
    failure: {
      code: CONTEXT_WINDOW_EXCEEDED_CODE,
      status: 400,
      message: `input of ${String(tokens)} tokens exceeds the ${String(window)}-token context window`,
    },
  },
})

const mountSetup = async (ctx: Context, setup: EngineSetup) => {
  if (setup === 'C' || setup === 'D') await ctx.plugin(ToolResultPruner, PRUNER_CONFIG)
  if (setup === 'C') return
  // The restated preset-standard `compaction` group: its own isolated compaction service and pruner.
  const preset = ctx.isolate('compaction').isolate('toolResultPruner')
  await preset.plugin(ToolResultPruner, PRUNER_CONFIG)
  await preset.plugin(BasicCompactionEngine, setup === 'B' ? { auto: false } : {})
}

/** Replays one recorded workload through the real agent loop with one engine setup, and measures it. */
export const replay = async (options: ReplayOptions): Promise<ReplayResult> => {
  const started = performance.now()
  const workload = options.workload
  const contextWindow = workload.route.contextWindow
  const host = await createTestHost()
  try {
    await host.ctx.plugin(SessionProjectionRegistry)
    await host.ctx.plugin(SessionStore)
    await host.ctx.plugin(LlmRuntime)
    await host.ctx.plugin(AgentRegistry)
    await host.ctx.plugin(TokenMeter)
    await host.ctx.plugin(AgentLoop)
    // The owned root row loads first, as its compaction failures precede the stock row's pruning in recorded logs.
    const mounted = await host.mount(plugin, { packageId: '@dshfiles/context-compaction', config: { maxTokens: 8_192, loadedSkills: options.loadedSkills } })
    await mountSetup(host.ctx, options.setup)
    const adapter = new ReplayAdapter(workload, contextWindow, options.defaultMaxTokens)
    host.ctx.llm.registerAdapter([workload.route.provider], adapter)
    const disposeSystem = host.ctx.systemPrompt.section({ name: 'replay-system', order: 0, text: filler(workload.systemChars, 'system') })
    const disposeTools = workload.tools.map(([name, chars]) =>
      host.tools.register({
        name: replayToolName(name),
        description: filler(Math.max(1, chars - name.length - 80), `tool-${name}`),
        parameters: { type: 'object', properties: { input: { type: 'string' } } },
        output: {
          schema: { type: 'object', properties: { callId: { type: 'string' } }, required: ['callId'] },
          render: (_args, value) => {
            const result = typeof value === 'object' && value !== null && 'callId' in value ? adapter.results.get(String(value.callId)) : undefined
            const images = Array.from({ length: result?.images ?? 0 }, () => adapter.nextImage())
            return [...images, { type: 'text', text: result?.text ?? '' }]
          },
        },
        execute: (_args, exec) => Promise.resolve({ callId: exec.callId }),
      }),
    )
    const sessionId = SessionId(`replay-${workload.name}`)
    const offEvent = host.ctx.on(
      'session/event',
      (_session, event) => {
        if (event.type === 'compaction/summary') adapter.checkpointPending = true
      },
      { global: true },
    )
    const handle = await host.ctx.agents.create({ sessionId, agentOptions: { provider: workload.route.provider, model: workload.route.model } })
    try {
      const userMessage = (event: UserEvent) => {
        const images = Array.from({ length: event[2] }, () => adapter.nextImage())
        return createUserMessage({
          content: [...images, { type: 'text', text: filler(Math.max(1, event[1]), `user-${String(adapter.cursor)}`) }],
          source: { kind: 'user' },
        })
      }
      let stalledTurns = 0
      let skippedSteps = 0
      while (adapter.cursor < workload.events.length) {
        const before = adapter.cursor
        const next = workload.events[adapter.cursor]
        if (next?.[0] === 'u') {
          for (let input = workload.events[adapter.cursor]; input?.[0] === 'u'; input = workload.events[adapter.cursor]) {
            await handle.agent.followup(userMessage(input))
            adapter.cursor += 1
          }
        } else await handle.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'continue' }], source: { kind: 'user' } }))
        await handle.agent.whenIdle()
        if (process.env['COMPACTION_REPLAY_TRACE'] !== undefined && adapter.cursor % 50 < 2)
          console.error(
            `${workload.name} ${options.setup} ${String(adapter.cursor)}/${String(workload.events.length)} requests=${String(adapter.agentRequests)}`,
          )
        // A turn that cannot send any request (an overflow nothing recovers) makes no progress: drop that step.
        stalledTurns = adapter.cursor === before && next?.[0] !== 'u' ? stalledTurns + 1 : 0
        if (stalledTurns >= 2) {
          adapter.cursor += 1
          skippedSteps += 1
          stalledTurns = 0
        }
      }
      const events = host.ctx.sessions.get(sessionId)?.snapshotEvents() ?? []
      const starts = new Map<string, number>()
      const wall: number[] = []
      let failed = 0
      let succeeded = 0
      let ours = 0
      let stock = 0
      let pruned = 0
      let failedTurns = 0
      const reasons: Record<string, number> = {}
      for (const event of events) {
        if (event.type === 'compaction/start') starts.set(event.data.compactionId, event.time)
        if (event.type === 'compaction/prune') pruned += 1
        if (event.type === 'compaction/summary') {
          if (event.data.maxTokens === 8_192) ours += 1
          else stock += 1
        }
        if (event.type === 'compaction/end') {
          const start = starts.get(event.data.compactionId)
          if (start !== undefined) wall.push(event.time - start)
          if ('error' in event.data && event.data.error !== undefined) {
            failed += 1
            const reason = String(event.data.error).slice(0, 48)
            reasons[reason] = (reasons[reason] ?? 0) + 1
          } else succeeded += 1
        }
        if (event.type === 'turn/end' && event.data.reason.kind !== 'completed') failedTurns += 1
      }
      return {
        scenario: workload.name,
        setup: options.setup,
        loadedSkills: options.loadedSkills,
        agentRequests: adapter.agentRequests,
        compactionsStarted: starts.size,
        compactionsSucceeded: succeeded,
        compactionsFailed: failed,
        checkpointsByOurs: ours,
        checkpointsByStock: stock,
        prunedResults: pruned,
        failureReasons: reasons,
        peakRequestTokens: adapter.peak,
        totalRequestTokens: adapter.total,
        prefixReuse: adapter.total === 0 ? 0 : adapter.reused / adapter.total,
        summaryRequests: adapter.summaryRequests,
        summaryInputTokens: adapter.summaryInputTokens,
        overflows: adapter.overflows,
        failedTurns,
        skippedSteps,
        compactionWallMs: wall,
        survival: adapter.survival,
        replayMs: performance.now() - started,
      }
    } finally {
      offEvent()
      await handle.dispose()
      for (const dispose of disposeTools) dispose()
      disposeSystem()
      await mounted.dispose()
    }
  } finally {
    await host.dispose()
  }
}
