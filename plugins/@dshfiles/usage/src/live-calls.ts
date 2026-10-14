import type { GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import type { RequestPurpose, RequestRow, TokenUsage } from './fold.js'

/**
 * Model calls outside the agent loop that the session log does not fully
 * record: OptMem summaries are absent from it, and title generation keeps no
 * usage. Observed on `llm/stream` (read-only, every chunk passes through
 * unchanged). Agent-loop calls carry `toolHistory` and are left to the log,
 * which already records them with their message.
 */

/** OptMem's summarizer system prompt; it shares the `compaction` purpose with native compaction. */
const OPTMEM_SYSTEM_PREFIX = 'You maintain the long-term memory'

export const livePurposeOf = (options: Pick<GenerateOptions, 'purpose' | 'system' | 'toolHistory'>): RequestPurpose | null => {
  if (options.purpose === 'session-title') return 'title'
  if (options.purpose === 'compaction') return (options.system ?? '').startsWith(OPTMEM_SYSTEM_PREFIX) ? 'memory' : 'compaction'
  if (options.toolHistory !== undefined) return null
  return 'other'
}

const ABORT_KINDS = new Set(['aborted', 'interrupted', 'cancelled'])

export const observeLiveCall = (input: {
  readonly options: GenerateOptions
  readonly next: () => AsyncIterable<StreamChunk>
  readonly record: (row: RequestRow) => void
  readonly now?: () => number
}): AsyncIterable<StreamChunk> => {
  const purpose = livePurposeOf(input.options)
  if (purpose === null || input.options.sessionId === undefined) return input.next()
  const sessionId: string = input.options.sessionId
  const now = input.now ?? Date.now
  return (async function* () {
    const startedAt = now()
    let firstChunkAt: number | null = null
    let usage: TokenUsage | null = null
    let finish: { readonly kind: string; readonly code: string | null } | null = null
    let thrown = false
    try {
      for await (const chunk of input.next()) {
        if (firstChunkAt === null && chunk.type !== 'finish' && chunk.type !== 'usage') firstChunkAt = now()
        if (chunk.type === 'usage')
          usage = {
            input: chunk.usage.inputTokens,
            cacheRead: chunk.usage.cacheReadTokens ?? 0,
            cacheWrite: chunk.usage.cacheWriteTokens ?? 0,
            output: chunk.usage.outputTokens,
            reasoning: chunk.usage.reasoningTokens ?? 0,
          }
        if (chunk.type === 'finish') finish = { kind: chunk.reason.kind, code: 'failure' in chunk.reason ? (chunk.reason.failure.code ?? null) : null }
        yield chunk
      }
    } catch (error) {
      thrown = true
      throw error
    } finally {
      const failed = thrown || finish?.kind === 'error'
      const aborted = !failed && (finish === null || ABORT_KINDS.has(finish.kind))
      try {
        input.record({
          id: `live:${sessionId}:${String(startedAt)}:${purpose}`,
          sessionId,
          seq: null,
          messageId: null,
          turn: null,
          step: null,
          purpose,
          source: 'live',
          provider: input.options.provider,
          model: input.options.model,
          startedAt,
          endedAt: now(),
          ttftMs: firstChunkAt === null ? null : firstChunkAt - startedAt,
          usage,
          status: failed ? 'failed' : aborted ? 'aborted' : 'ok',
          stopReason: finish?.kind ?? null,
          errorCode: finish?.code ?? null,
        })
      } catch {
        // Recording is best effort; it must never break the caller's stream.
      }
    }
  })()
}
