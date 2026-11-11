/**
 * Continues a reply the provider stopped at the output-token limit
 * (`finish: max-tokens`). The cut reply stays in history exactly as streamed;
 * the loop then runs a bounded number of extra steps whose only new input is a
 * note asking the model to pick up where it stopped without repeating itself.
 * Tool calls the limit cut are dropped by the native assembler (never run); the
 * note names them so the model can send them again, smaller.
 * @module dsh-agent-loop/output-limit-continuation
 */

import { createUserMessage, type StreamChunk } from '@deepseek-ai/dsh-llm'
import type { UserMessage } from '@deepseek-ai/dsh-session'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'output-limit-continuation': { kind: 'output-limit-continuation'; attempt: number; max: number }
  }
}

export const OUTPUT_LIMIT_CONTINUATION_SOURCE = 'output-limit-continuation'
/** Off by default: each continuation is one more model call nobody asked for. */
export const DEFAULT_MAX_OUTPUT_LIMIT_CONTINUATIONS = 0
export const MAX_OUTPUT_LIMIT_CONTINUATIONS = 2

const TAIL_CHARS = 200

/** Watches one attempt's chunks for what the limit cut: tool call names and the end of the visible text. */
export class OutputLimitCut {
  private readonly toolNames = new Map<number, string>()
  private text = ''

  observe(chunk: StreamChunk): void {
    if (chunk.type === 'tool-call-delta' && chunk.name) this.toolNames.set(chunk.index, chunk.name)
    if (chunk.type === 'block-start' && chunk.blockType === 'tool-call' && !this.toolNames.has(chunk.index)) this.toolNames.set(chunk.index, '')
    if (chunk.type === 'text-delta') this.text = (this.text + chunk.text).slice(-TAIL_CHARS)
  }

  /** The note the next step reads; `attempt` is 1-based. */
  message(input: { readonly attempt: number; readonly max: number }): UserMessage {
    const names = [...this.toolNames.values()].map(name => (name === '' ? 'an unnamed tool' : `"${name}"`))
    const lines = [
      `Your previous reply stopped at the output-token limit (automatic continuation ${input.attempt} of ${input.max}).`,
      'Continue exactly where it stopped. Do not repeat or summarize text you already wrote; it is kept above.',
    ]
    if (this.text.trim() !== '') lines.push(`It ended with: «${this.text}»`)
    if (names.length > 0) {
      lines.push(
        `The limit cut ${names.length === 1 ? 'a tool call' : `${names.length} tool calls`} (${names.join(', ')}) before its arguments finished, so nothing ran. Send it again with smaller arguments: split large content across several calls.`,
      )
    }
    return createUserMessage({
      content: [{ type: 'text', text: lines.join('\n') }],
      source: { kind: OUTPUT_LIMIT_CONTINUATION_SOURCE, attempt: input.attempt, max: input.max },
    })
  }
}
