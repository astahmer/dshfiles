/**
 * Bounds how much and how long a model may stream one tool call's arguments.
 * A degenerate generation (2026-11-11: an `apply_patch` call streamed 199 KB of
 * whitespace over 15 minutes) otherwise holds the turn until the provider drops
 * the connection, then fails the whole step. Past either bound the attempt
 * stops, the cut calls are recorded without running, and each gets an error
 * result the model can act on in its next step.
 * @module dsh-agent-loop/tool-argument-limit
 */

import { createToolResultMessage, ToolCallId, type StreamChunk, type ToolCallBlock } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'

/** One tool call's argument stream may not exceed either bound. */
export interface ToolArgumentLimits {
  readonly maxBytes: number
  readonly maxMs: number
}

export const DEFAULT_MAX_TOOL_CALL_ARGUMENT_BYTES = 512 * 1024
export const DEFAULT_TOOL_CALL_ARGUMENT_TIMEOUT_MS = 180_000

export const TOOL_ARGUMENTS_LIMIT_EXCEEDED = 'TOOL_ARGUMENTS_LIMIT_EXCEEDED'

interface OpenCall {
  id: ToolCallBlock['id'] | undefined
  name: string
  bytes: number
  readonly startedAt: number
}

/** A tool call whose arguments were discarded, with the reason its result reports. */
export interface CutToolCall {
  readonly index: number
  readonly block: ToolCallBlock
  readonly reason: 'size' | 'time' | 'sibling'
  readonly bytes: number
  readonly elapsedMs: number
}

const kib = (bytes: number): string => (bytes < 10_240 ? `${bytes} B` : `${Math.round(bytes / 1024)} KiB`)
const seconds = (ms: number): string => (ms < 10_000 ? `${ms} ms` : `${Math.round(ms / 1000)} s`)

/** Watches one attempt's chunks and names the calls to cut once a bound is crossed. */
export class ToolArgumentLimit {
  private readonly open = new Map<number, OpenCall>()

  constructor(
    private readonly limits: ToolArgumentLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Observe one chunk before it is assembled.
   * @returns every still-open tool call when this chunk crosses a bound (the crossing one first), else undefined.
   */
  observe(chunk: StreamChunk): readonly CutToolCall[] | undefined {
    if (chunk.type === 'block-start' && chunk.blockType === 'tool-call') {
      this.callAt(chunk.index)
      return undefined
    }
    if (chunk.type === 'block-end') {
      this.open.delete(chunk.index)
      return undefined
    }
    if (chunk.type !== 'tool-call-delta') return undefined
    const call = this.callAt(chunk.index)
    call.id = chunk.id
    if (chunk.name) call.name = chunk.name
    call.bytes += Buffer.byteLength(chunk.argumentsDelta)
    const elapsedMs = this.now() - call.startedAt
    const reason = call.bytes > this.limits.maxBytes ? 'size' : elapsedMs > this.limits.maxMs ? 'time' : undefined
    if (reason === undefined) return undefined
    const crossing = this.cut(chunk.index, call, reason)
    const siblings = [...this.open].filter(([index]) => index !== chunk.index).map(([index, sibling]) => this.cut(index, sibling, 'sibling'))
    return [crossing, ...siblings]
  }

  private callAt(index: number): OpenCall {
    const existing = this.open.get(index)
    if (existing !== undefined) return existing
    const call: OpenCall = { id: undefined, name: '', bytes: 0, startedAt: this.now() }
    this.open.set(index, call)
    return call
  }

  private cut(index: number, call: OpenCall, reason: CutToolCall['reason']): CutToolCall {
    return {
      index,
      reason,
      bytes: call.bytes,
      elapsedMs: this.now() - call.startedAt,
      block: { type: 'tool-call', id: call.id ?? ToolCallId(`call-${index}`), name: call.name, arguments: '{}' },
    }
  }

  /** The closing chunks that end the attempt at the cut: each cut call closes with empty arguments. */
  static closingChunks(cut: readonly CutToolCall[]): StreamChunk[] {
    return [
      ...cut.map((call): StreamChunk => ({ type: 'block-end', index: call.index, block: call.block })),
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ]
  }

  /** What the model reads instead of the tool's output: what happened and how to retry. */
  static resultText(call: CutToolCall, limits: ToolArgumentLimits): string {
    if (call.reason === 'sibling') {
      return `Error: tool call "${call.block.name}" was not run: another call in the same reply exceeded the tool-argument limit, so the reply was stopped before these arguments finished. Nothing was executed. Send this call again on its own.`
    }
    const measured = call.reason === 'size' ? `${kib(call.bytes)} of arguments (limit ${kib(limits.maxBytes)})` : `arguments for ${seconds(call.elapsedMs)} (limit ${seconds(limits.maxMs)}, ${kib(call.bytes)} so far)`
    return [
      `Error: tool call "${call.block.name}" was not run: the model streamed ${measured}, so the arguments were discarded. Nothing was executed.`,
      'Retry with smaller arguments: write large content to a file in several smaller calls (for example apply_patch with one edit per call, or append in chunks) instead of one huge call. If the arguments were repeating, start the content again from the last complete part.',
      'The limits are the agent-loop settings maxToolCallArgumentBytes and toolCallArgumentTimeoutMs.',
    ].join('\n')
  }

  /** Record one cut call and its error result, so replay pairs every model call with a result. */
  static appendCutResult(session: Session, turn: number, step: number, call: CutToolCall, limits: ToolArgumentLimits): void {
    const callEvent = session.append('tool/call', { turn, step, callId: call.block.id, name: call.block.name, arguments: call.block.arguments })
    const text = ToolArgumentLimit.resultText(call, limits)
    session.append('tool/result', {
      turn,
      step,
      message: createToolResultMessage({ callId: call.block.id, content: [{ type: 'text', text }], isError: true }),
      error: { name: 'ToolArgumentsLimitExceeded', code: TOOL_ARGUMENTS_LIMIT_EXCEEDED },
    }, { surfaceOp: 'append', sourceEventSeqs: [callEvent.seq] })
  }
}
