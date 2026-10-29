import type { StreamChunk } from '@deepseek-ai/dsh-llm'
import { decodeJson, jsonValueSchema, type JsonValue } from '@dshfiles/dshx/json'
import { recordSpans, startSpan, tracingEnabled, withSpan, type RecordedSpan, type SpanRecorder } from '@dshfiles/dshx/tracing'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createCoordinator, type ObservedEvent, type ObservedLlmRequest, type ObservedSession, type ObservedToolResult } from './coordinator.js'

const bigintSchema = z.bigint()

let capture = false
const warnings: string[] = []
const coordinator = () => createCoordinator({ captureContent: () => capture, warn: message => warnings.push(message) })

afterEach(() => {
  capture = false
  warnings.splice(0)
})

const session = (id: string, header: ObservedSession['header'] = {}): ObservedSession => ({ id, header: { cwd: '/repo', ...header } })

/** A value the replacer sees while JSON-rendering recorded spans: JSON fields beside bigint nanosecond times. */
type RenderedSpanValue = JsonValue | bigint | undefined

const emit = (observer: ReturnType<typeof coordinator>, observed: ObservedSession, type: string, data: ObservedEvent['data']) =>
  observer.onEvent(observed, { type, data })

const toolResult = (callId: string, isError = false) => ({
  role: 'user',
  content: [{ type: 'tool-result', toolCallId: callId, content: [{ type: 'text', text: 'TOOL-OUTPUT-SECRET' }], isError }],
  source: { kind: 'tool', callId },
})

const ok: ObservedToolResult = { isError: false }

const chunks = (): StreamChunk[] => [
  { type: 'text-delta', index: 0, text: 'REPLY-SECRET' },
  { type: 'block-end', index: 0, block: { type: 'text', text: 'REPLY-SECRET' } },
  { type: 'usage', usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 3, cacheWriteTokens: 2 } },
  { type: 'finish', reason: { kind: 'stop' } },
]

const stream = async function* (items: readonly StreamChunk[]): AsyncGenerator<StreamChunk> {
  yield* items
}

const drain = async (iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> => {
  const seen: StreamChunk[] = []
  for await (const chunk of iterable) seen.push(chunk)
  return seen
}

const request = (sessionId: string | undefined, extra: Partial<ObservedLlmRequest> = {}): ObservedLlmRequest => ({
  provider: 'kilo',
  model: 'kilo-auto/free',
  sessionId,
  system: 'SYSTEM-SECRET',
  ...extra,
})

/** One turn: a model call that asks for `bash`, the tool runs (its body opens a plugin span), the turn completes. */
const runTurn = async (observer: ReturnType<typeof coordinator>, observed: ObservedSession) => {
  emit(observer, observed, 'turn/start', { turn: 1 })
  emit(observer, observed, 'user/message', { role: 'user', content: [{ type: 'text', text: 'PROMPT-SECRET' }], source: { kind: 'user' } })
  emit(observer, observed, 'step/start', { turn: 1, step: 1 })
  await drain(observer.interceptLlm(request(observed.id), () => stream(chunks())))
  emit(observer, observed, 'assistant/message', {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [{ type: 'text', text: 'REPLY-SECRET' }], source: { kind: 'llm' } },
  })
  emit(observer, observed, 'tool/call', { turn: 1, step: 1, callId: 'call-1', name: 'bash', arguments: '{"command":"ARGS-SECRET"}' })
  await observer.runTool({ callId: 'call-1', rootCallId: 'call-1', name: 'bash', agent: { id: observed.id } }, () =>
    withSpan('jj log', async () => withSpan('secret resolve', async () => ok)),
  )
  emit(observer, observed, 'tool/result', { turn: 1, step: 1, message: toolResult('call-1') })
  emit(observer, observed, 'step/end', { turn: 1, step: 1 })
  emit(observer, observed, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
}

const parentOf = (recorder: SpanRecorder, span: RecordedSpan): RecordedSpan | undefined =>
  recorder.spans.find(candidate => candidate.spanId === span.parentSpanId)

describe('LoongSuite parity', () => {
  it('emits enter → invoke_agent → react step → chat and execute_tool with the GenAI attributes', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    await runTurn(observer, session('s-1', { agentPreset: 'coder' }))

    const entry = recorder.span('enter_ai_application_system')
    const agent = recorder.span('invoke_agent coder')
    const step = recorder.span('react step')
    const chat = recorder.span('chat kilo-auto/free')
    const tool = recorder.span('execute_tool bash')
    expect(entry).toMatchObject({ kind: 'server', parentSpanId: undefined, status: { code: 'ok' } })
    expect(parentOf(recorder, agent)).toBe(entry)
    expect(parentOf(recorder, step)).toBe(agent)
    expect(parentOf(recorder, chat)).toBe(step)
    expect(parentOf(recorder, tool)).toBe(step)
    expect(new Set(recorder.spans.map(span => span.traceId)).size).toBe(1)

    expect(entry.attributes).toMatchObject({
      'gen_ai.operation.name': 'enter',
      'gen_ai.span.kind': 'ENTRY',
      'gen_ai.session.id': 's-1',
      'gen_ai.turn.id': 's-1:1',
      'dsh.session.id': 's-1',
      'dsh.turn': 1,
      'dsh.session.cwd': '/repo',
      'dsh.agent.preset': 'coder',
      'gen_ai.agent.name': 'coder',
      'dsh.turn.end_reason': 'completed',
      'dsh.trace.parent_link': 'root',
    })
    expect(agent).toMatchObject({ kind: 'client' })
    expect(agent.attributes).toMatchObject({
      'gen_ai.operation.name': 'invoke_agent',
      'gen_ai.span.kind': 'AGENT',
      'gen_ai.provider.name': 'kilo',
      'gen_ai.request.model': 'kilo-auto/free',
      'gen_ai.conversation.id': 's-1',
      'gen_ai.usage.input_tokens': 15,
      'gen_ai.usage.output_tokens': 5,
      'gen_ai.usage.cache_read.input_tokens': 3,
      'gen_ai.usage.cache_creation.input_tokens': 2,
      'gen_ai.usage.total_tokens': 20,
      'gen_ai.response.finish_reasons': ['completed'],
    })
    expect(step.attributes).toMatchObject({
      'gen_ai.operation.name': 'react',
      'gen_ai.span.kind': 'STEP',
      'gen_ai.react.round': 1,
      'gen_ai.react.finish_reason': 'stop',
      'gen_ai.step.id': 's-1:1:1',
      'dsh.step': 1,
    })
    expect(chat).toMatchObject({ kind: 'client', status: { code: 'ok' } })
    expect(chat.attributes).toMatchObject({
      'gen_ai.operation.name': 'chat',
      'gen_ai.span.kind': 'LLM',
      'gen_ai.request.model': 'kilo-auto/free',
      'gen_ai.response.model': 'kilo-auto/free',
      'gen_ai.provider.name': 'kilo',
      'gen_ai.response.finish_reasons': ['stop'],
      'gen_ai.usage.input_tokens': 15,
      'gen_ai.usage.total_tokens': 20,
      'dsh.llm.attempt': 1,
    })
    expect(chat.attributes['gen_ai.response.time_to_first_token']).toBeGreaterThanOrEqual(0)
    expect(tool.attributes).toMatchObject({
      'gen_ai.operation.name': 'execute_tool',
      'gen_ai.span.kind': 'TOOL',
      'gen_ai.tool.name': 'bash',
      'gen_ai.tool.call.id': 'call-1',
      'gen_ai.tool.type': 'function',
      'dsh.step': 1,
    })
  })

  it('marks an aborted turn, a failed model attempt and a failed tool as errors with a type, never a message', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-2')
    emit(observer, observed, 'turn/start', { turn: 1 })
    emit(observer, observed, 'step/start', { turn: 1, step: 1 })
    await drain(
      observer.interceptLlm(request('s-2'), () =>
        stream([{ type: 'finish', reason: { kind: 'error', failure: { message: 'provider said PRIVATE-PROMPT', code: 'UPSTREAM_503' } } }]),
      ),
    )
    emit(observer, observed, 'tool/call', { turn: 1, step: 1, callId: 'c', name: 'read', arguments: '{}' })
    emit(observer, observed, 'tool/result', { turn: 1, step: 1, message: toolResult('c', true), error: { name: 'FileNotFound', code: 'ENOENT' } })
    emit(observer, observed, 'turn/end', { turn: 1, reason: { kind: 'aborted', reason: { kind: 'user' } } })

    expect(recorder.span('chat kilo-auto/free').status).toEqual({ code: 'error', message: 'UPSTREAM_503' })
    expect(recorder.span('execute_tool read')).toMatchObject({
      status: { code: 'error', message: 'ENOENT' },
      attributes: { 'error.type': 'ENOENT', 'dsh.tool.error.name': 'FileNotFound' },
    })
    expect(recorder.span('react step').status).toEqual({ code: 'error', message: 'INTERRUPTED' })
    expect(recorder.span('invoke_agent deepseek-harness')).toMatchObject({
      status: { code: 'error', message: 'ABORTED' },
      attributes: { 'dsh.turn.end_reason': 'aborted' },
    })
    expect(JSON.stringify(recorder.spans, (_key, value: RenderedSpanValue) => (bigintSchema.safeParse(value).success ? String(value) : value))).not.toContain(
      'PRIVATE-PROMPT',
    )
  })
})

describe('real nesting through tools/execute', () => {
  it('runs the tool body with its execute_tool span active, so plugin spans nest under it', async () => {
    using recorder = recordSpans()
    await runTurn(coordinator(), session('s-3'))
    const tool = recorder.span('execute_tool bash')
    const jj = recorder.span('jj log')
    expect(parentOf(recorder, jj)).toBe(tool)
    expect(parentOf(recorder, recorder.span('secret resolve'))).toBe(jj)
    expect(jj.traceId).toBe(recorder.span('enter_ai_application_system').traceId)
  })

  it('gives a nested run_code sub-dispatch its own span under the active tool', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-4')
    emit(observer, observed, 'turn/start', { turn: 1 })
    emit(observer, observed, 'step/start', { turn: 1, step: 1 })
    emit(observer, observed, 'tool/call', { turn: 1, step: 1, callId: 'run', name: 'run_code', arguments: '{}' })
    await observer.runTool({ callId: 'run', rootCallId: 'run', name: 'run_code', agent: { id: 's-4' } }, () =>
      observer.runTool({ callId: 'run:ptc:1', rootCallId: 'run', name: 'grep', agent: { id: 's-4' }, parent: Symbol('outer') }, async () => ({
        isError: true,
        error: { info: { code: 'NO_MATCH' } },
      })),
    )
    emit(observer, observed, 'tool/result', { turn: 1, step: 1, message: toolResult('run') })
    const nested = recorder.span('execute_tool grep')
    expect(parentOf(recorder, nested)?.name).toBe('execute_tool run_code')
    expect(nested).toMatchObject({ status: { code: 'error', message: 'NO_MATCH' }, attributes: { 'dsh.tool.root_call_id': 'run' } })
  })

  it('opens the tool span at dispatch when tools/execute runs before the tool/call event', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-5')
    emit(observer, observed, 'turn/start', { turn: 1 })
    emit(observer, observed, 'step/start', { turn: 1, step: 1 })
    await observer.runTool({ callId: 'early', rootCallId: 'early', name: 'bash', agent: { id: 's-5' } }, async () => {
      emit(observer, observed, 'tool/call', { turn: 1, step: 1, callId: 'early', name: 'bash', arguments: '{}' })
      return withSpan('jj status', async () => ok)
    })
    emit(observer, observed, 'tool/result', { turn: 1, step: 1, message: toolResult('early') })
    expect(recorder.named('execute_tool bash')).toHaveLength(1)
    expect(parentOf(recorder, recorder.span('jj status'))?.name).toBe('execute_tool bash')
  })
})

describe('subagent parenting', () => {
  const startParentTool = (observer: ReturnType<typeof coordinator>, parent: ObservedSession) => {
    emit(observer, parent, 'turn/start', { turn: 1 })
    emit(observer, parent, 'step/start', { turn: 1, step: 1 })
    emit(observer, parent, 'tool/call', { turn: 1, step: 1, callId: 'spawn', name: 'subagent', arguments: '{}' })
  }

  const childTurn = (observer: ReturnType<typeof coordinator>, child: ObservedSession) => {
    emit(observer, child, 'turn/start', { turn: 1 })
    emit(observer, child, 'step/start', { turn: 1, step: 1 })
    emit(observer, child, 'step/end', { turn: 1, step: 1 })
    emit(observer, child, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
  }

  it('puts a subagent created inside the parent tool body under that execute_tool span, in one trace', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const parent = session('parent')
    const child = session('child', { parentSession: 'parent', origin: 'subagent', delegationDepth: 1 })
    startParentTool(observer, parent)
    await observer.runTool({ callId: 'spawn', rootCallId: 'spawn', name: 'subagent', agent: { id: 'parent' } }, async () => {
      observer.onCreated(child)
      childTurn(observer, child)
      return ok
    })
    emit(observer, parent, 'tool/result', { turn: 1, step: 1, message: toolResult('spawn') })
    emit(observer, parent, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    const tool = recorder.span('execute_tool subagent')
    const [parentEntry, childEntry] = recorder
      .named('enter_ai_application_system')
      .toSorted((left, right) => Number(left.startTimeUnixNano - right.startTimeUnixNano))
    expect(parentOf(recorder, childEntry!)).toBe(tool)
    expect(childEntry?.attributes).toMatchObject({ 'dsh.session.id': 'child', 'dsh.session.parent_id': 'parent', 'dsh.trace.parent_link': 'async-context' })
    expect(childEntry?.traceId).toBe(parentEntry?.traceId)
  })

  it('keeps the creation-time tool span for a later child turn started outside it', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const parent = session('p2')
    const child = session('c2', { parentSession: 'p2', origin: 'subagent' })
    startParentTool(observer, parent)
    await observer.runTool({ callId: 'spawn', rootCallId: 'spawn', name: 'subagent', agent: { id: 'p2' } }, async () => {
      observer.onCreated(child)
      return ok
    })
    emit(observer, parent, 'tool/result', { turn: 1, step: 1, message: toolResult('spawn') })
    childTurn(observer, child)
    const childEntry = recorder.named('enter_ai_application_system').find(span => span.attributes['dsh.session.id'] === 'c2')
    expect(childEntry?.attributes['dsh.trace.parent_link']).toBe('created-in-tool')
    expect(parentOf(recorder, childEntry!)?.name).toBe('execute_tool subagent')
  })

  it('falls back to the parent session running delegation tool, then its turn', () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const parent = session('p3')
    startParentTool(observer, parent)
    const child = session('c3', { parentSession: 'p3', origin: 'subagent' })
    observer.adopt(child)
    childTurn(observer, child)
    emit(observer, parent, 'tool/result', { turn: 1, step: 1, message: toolResult('spawn') })
    const orphan = session('c4', { parentSession: 'p3', origin: 'subagent' })
    observer.adopt(orphan)
    childTurn(observer, orphan)
    const entries = new Map(recorder.named('enter_ai_application_system').map(span => [span.attributes['dsh.session.id'], span]))
    expect(entries.get('c3')?.attributes['dsh.trace.parent_link']).toBe('running-tool')
    expect(parentOf(recorder, entries.get('c3')!)?.name).toBe('execute_tool subagent')
    expect(entries.get('c4')?.attributes['dsh.trace.parent_link']).toBe('parent-turn')
  })

  it('keeps a user fork of a thread in its own trace', () => {
    using recorder = recordSpans()
    const observer = coordinator()
    startParentTool(observer, session('p5'))
    const fork = session('fork', { parentSession: 'p5' })
    childTurn(observer, fork)
    expect(recorder.named('enter_ai_application_system').find(span => span.attributes['dsh.session.id'] === 'fork')).toMatchObject({
      parentSpanId: undefined,
      attributes: { 'dsh.trace.parent_link': 'root' },
    })
  })
})

describe('model calls with a purpose and outside a step', () => {
  it('records a compaction call under its compaction span and a title call under the turn', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-6')
    emit(observer, observed, 'turn/start', { turn: 1 })
    await drain(observer.interceptLlm(request('s-6', { purpose: 'session-title' }), () => stream(chunks())))
    emit(observer, observed, 'compaction/start', { compactionId: 'k1', turn: 1 })
    await drain(observer.interceptLlm(request('s-6', { purpose: 'compaction' }), () => stream(chunks())))
    emit(observer, observed, 'compaction/end', { compactionId: 'k1', turn: 1 })
    emit(observer, observed, 'turn/end', { turn: 1, reason: { kind: 'completed' } })

    const [title, compactionCall] = recorder.named('chat kilo-auto/free')
    expect(title?.attributes).toMatchObject({ 'dsh.llm.purpose': 'session-title', 'gen_ai.operation.name': 'chat', 'dsh.llm.standalone': true })
    expect(parentOf(recorder, title!)?.name).toBe('invoke_agent deepseek-harness')
    expect(compactionCall?.attributes['dsh.llm.purpose']).toBe('compaction')
    expect(parentOf(recorder, compactionCall!)?.name).toBe('compaction')
    expect(recorder.span('compaction').status.code).toBe('ok')
  })

  it('parents a session-less model call to the active plugin span, or starts a trace', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    await withSpan('btw answer', async () => drain(observer.interceptLlm(request(undefined), () => stream(chunks()))))
    await drain(observer.interceptLlm(request(undefined, { model: 'other' }), () => stream(chunks())))
    expect(parentOf(recorder, recorder.span('chat kilo-auto/free'))?.name).toBe('btw answer')
    expect(recorder.span('chat other').parentSpanId).toBeUndefined()
  })
})

describe('wait spans', () => {
  it('records approval, model retry and background job waits under the right parent', () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-7')
    emit(observer, observed, 'turn/start', { turn: 1 })
    emit(observer, observed, 'step/start', { turn: 1, step: 1 })
    emit(observer, observed, 'llm/retry', {
      retryId: 'r1',
      turn: 1,
      step: 1,
      provider: 'kilo',
      mode: 'normal',
      policyKey: 'k',
      retry: 1,
      maxRetries: 3,
      delayMs: 500,
      failure: { message: 'RETRY-SECRET', code: 'RATE_LIMITED' },
    })
    emit(observer, observed, 'llm/retry-started', { retryId: 'r1', turn: 1, step: 1, retry: 1 })
    emit(observer, observed, 'tool/call', { turn: 1, step: 1, callId: 'rm', name: 'bash', arguments: '{}' })
    emit(observer, observed, 'approval/asked', { id: 'a1', toolName: 'bash', callId: 'rm', reason: 'REASON-SECRET' })
    emit(observer, observed, 'approval/decided', { id: 'a1', outcome: 'allowed-once' })
    emit(observer, observed, 'job/registered', {
      jobId: 'j1',
      owner: 's-7',
      kind: 'bash',
      label: 'LABEL-SECRET',
      startedAt: 1,
      toolCall: { callId: 'rm', rootCallId: 'rm' },
    })
    emit(observer, observed, 'tool/result', { turn: 1, step: 1, message: toolResult('rm') })
    emit(observer, observed, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    emit(observer, observed, 'job/settled', { jobId: 'j1', status: 'failed', cause: 'producer', producerReported: true, finishedAt: 2 })

    expect(parentOf(recorder, recorder.span('llm retry wait'))?.name).toBe('react step')
    expect(recorder.span('llm retry wait').attributes).toMatchObject({
      'dsh.wait.kind': 'llm-retry',
      'dsh.llm.retry': 1,
      'dsh.llm.retry.delay_ms': 500,
      'error.type': 'RATE_LIMITED',
    })
    expect(parentOf(recorder, recorder.span('approval wait'))?.name).toBe('execute_tool bash')
    expect(recorder.span('approval wait').attributes).toMatchObject({ 'dsh.wait.kind': 'approval', 'dsh.approval.outcome': 'allowed-once' })
    expect(parentOf(recorder, recorder.span('job bash'))?.name).toBe('execute_tool bash')
    expect(recorder.span('job bash')).toMatchObject({
      kind: 'producer',
      status: { code: 'error', message: 'JOB_FAILED' },
      attributes: { 'dsh.job.status': 'failed' },
    })
    const exported = JSON.stringify(recorder.spans.map(span => span.attributes))
    expect(exported).not.toMatch(/RETRY-SECRET|REASON-SECRET|LABEL-SECRET/u)
  })

  it('counts input spliced into a running turn', () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-8')
    emit(observer, observed, 'turn/start', { turn: 1 })
    emit(observer, observed, 'agent/inbox/spliced', { target: 'steer', start: 0, inserted: [{}, {}] })
    emit(observer, observed, 'agent/inbox/spliced', { target: 'steer', start: 0, inserted: [{}], outcome: 'canceled' })
    emit(observer, observed, 'turn/end', { turn: 1, reason: { kind: 'completed' } })
    expect(recorder.span('invoke_agent deepseek-harness').attributes['dsh.inbox.spliced_messages']).toBe(2)
  })
})

describe('content capture', () => {
  it('keeps prompts, replies, tool arguments and results off spans by default', async () => {
    using recorder = recordSpans()
    await runTurn(coordinator(), session('s-9'))
    const exported = JSON.stringify(recorder.spans.map(span => span.attributes))
    expect(exported).not.toMatch(/PROMPT-SECRET|REPLY-SECRET|ARGS-SECRET|TOOL-OUTPUT-SECRET|SYSTEM-SECRET/u)
    expect(exported).not.toContain('gen_ai.input.messages')
  })

  it('puts content on spans when switched on, as bounded JSON', async () => {
    capture = true
    using recorder = recordSpans()
    await runTurn(coordinator(), session('s-10'))
    const chat = recorder.span('chat kilo-auto/free').attributes
    expect(decodeJson(jsonValueSchema, String(chat['gen_ai.input.messages']))).toEqual([{ role: 'user', parts: [{ type: 'text', content: 'PROMPT-SECRET' }] }])
    expect(String(chat['gen_ai.output.messages'])).toContain('REPLY-SECRET')
    expect(String(chat['gen_ai.system_instructions'])).toContain('SYSTEM-SECRET')
    expect(recorder.span('execute_tool bash').attributes['gen_ai.tool.call.arguments']).toBe('{"command":"ARGS-SECRET"}')
    expect(String(recorder.span('execute_tool bash').attributes['gen_ai.tool.call.result'])).toContain('TOOL-OUTPUT-SECRET')
    expect(String(recorder.span('invoke_agent deepseek-harness').attributes['gen_ai.output.messages'])).toContain('REPLY-SECRET')
  })
})

describe('failure containment', () => {
  it('never throws into DSH on malformed events and keeps the stream and tool results unchanged', async () => {
    using recorder = recordSpans()
    const observer = coordinator()
    const observed = session('s-11')
    expect(() => emit(observer, observed, 'turn/start', null)).not.toThrow()
    expect(() => emit(observer, observed, 'tool/result', { turn: 'x' })).not.toThrow()
    expect(warnings.length).toBeGreaterThanOrEqual(2)
    const result = { isError: false, value: 1 }
    await expect(observer.runTool({ callId: 'x', rootCallId: 'x', name: 'bash', agent: { id: 'nobody' } }, async () => result)).resolves.toBe(result)
    const failure = new TypeError('tool body broke')
    await expect(observer.runTool({ callId: 'y', rootCallId: 'y', name: 'bash' }, () => Promise.reject(failure))).rejects.toBe(failure)
    expect(await drain(observer.interceptLlm(request(undefined), () => stream(chunks())))).toEqual(chunks())
    const broken = async function* (): AsyncGenerator<StreamChunk> {
      yield { type: 'text-delta', index: 0, text: 'a' }
      throw new RangeError('socket closed')
    }
    await expect(drain(observer.interceptLlm(request(undefined, { model: 'broken' }), broken))).rejects.toThrow(RangeError)
    expect(recorder.span('chat broken').status).toEqual({ code: 'error', message: 'RangeError' })
  })

  it('returns the inner iterator to the provider when the consumer stops early', async () => {
    using recorder = recordSpans()
    let returned = false
    const provider: AsyncIterable<StreamChunk> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ done: false, value: { type: 'text-delta', index: 0, text: 'x' } }),
        return: async () => {
          returned = true
          return { done: true, value: undefined }
        },
      }),
    }
    for await (const _chunk of coordinator().interceptLlm(request(undefined), () => provider)) break
    expect(returned).toBe(true)
    expect(recorder.span('chat kilo-auto/free').status.message).toBe('CONSUMER_STOPPED')
  })
})

describe('without a destination', () => {
  it('passes tools and model streams through untouched and records nothing', async () => {
    expect(tracingEnabled()).toBe(false)
    const observer = coordinator()
    const provider = stream(chunks())
    expect(observer.interceptLlm(request(undefined), () => provider)).toBe(provider)
    const result = Promise.resolve(ok)
    expect(observer.runTool({ callId: 'z', rootCallId: 'z', name: 'bash' }, () => result)).toBe(result)
    await runTurn(observer, session('s-12'))
    expect(startSpan('probe').recording).toBe(false)
  })
})
