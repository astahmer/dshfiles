import { createSystemMessage, createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Message } from '@deepseek-ai/dsh-llm'
import { describe, expect, it } from '@effect/vitest'
import { Effect } from 'effect'
import { compactionRequestBudget, FALLBACK_CONTEXT_WINDOW } from '../src/budget.js'
import { CompactionBudgetExceeded, serializedMessageBytes, splitSummarizationInput } from '../src/chunked-summary.js'

/** session-6bd264fb's routed request: 365 tool schemas serialize to 203,657 bytes and its system prompt to 8,709. */
const MEASURED_PREFIX_BYTES = 212_366
const MEASURED_CONTEXT_WINDOW = 272_000

const prefixOf = (bytes: number) => createSystemMessage('p'.repeat(bytes))

const split = (options: { readonly messages: readonly Message[]; readonly maxInputBytes: number }) =>
  splitSummarizationInput({ input: { messages: options.messages }, maxInputBytes: options.maxInputBytes, messageBytes: serializedMessageBytes })

describe('the compaction request budget', () => {
  it('gives a declared window room for the session’s own system prompt and tool catalog', () => {
    const budget = compactionRequestBudget({ contextWindow: MEASURED_CONTEXT_WINDOW, maxTokens: 8_192 })
    expect(budget).toBeGreaterThan(MEASURED_PREFIX_BYTES)
    // The 64 KB ceiling this replaced refused every one of these requests, whatever the route declared.
    expect(budget).toBeGreaterThan(64_000)
    // Still inside the window: 3 bytes per token at the safety fraction, never the window's own token count.
    expect(budget).toBeLessThan(MEASURED_CONTEXT_WINDOW * 3)
  })

  it('keeps the fallback window identical to declaring it explicitly', () => {
    expect(compactionRequestBudget({ contextWindow: undefined, maxTokens: 8_192 })).toBe(
      compactionRequestBudget({ contextWindow: FALLBACK_CONTEXT_WINDOW, maxTokens: 8_192 }),
    )
  })

  it('leaves no budget when the completion alone fills the window', () => {
    expect(compactionRequestBudget({ contextWindow: 8_192, maxTokens: 8_192 })).toBe(0)
    expect(compactionRequestBudget({ contextWindow: 4_096, maxTokens: 8_192 })).toBe(0)
  })

  it.effect('still refuses a catalog the fallback window cannot fit, instead of sending it oversized', () =>
    Effect.gen(function* () {
      const budget = compactionRequestBudget({ contextWindow: undefined, maxTokens: 8_192 })
      expect(budget).toBeLessThan(MEASURED_PREFIX_BYTES)
      const failure = yield* split({ messages: [prefixOf(MEASURED_PREFIX_BYTES)], maxInputBytes: budget }).pipe(Effect.flip)
      expect(failure).toBeInstanceOf(CompactionBudgetExceeded)
      expect(failure.reason).toBe('prefix-too-large')
    }),
  )

  it.effect('accepts the same catalog once the route declares its window', () =>
    Effect.gen(function* () {
      const budget = compactionRequestBudget({ contextWindow: MEASURED_CONTEXT_WINDOW, maxTokens: 8_192 })
      const userMessage = createUserMessage({ content: [{ type: 'text', text: 'Condense this turn.' }], source: { kind: 'user' } })
      const chunks = yield* split({ messages: [prefixOf(MEASURED_PREFIX_BYTES), userMessage], maxInputBytes: budget })
      expect(chunks).toHaveLength(1)
      expect(chunks[0]?.messages).toHaveLength(2)
    }),
  )

  it.effect('still summarizes an ordinary prefix when the route declares no window', () =>
    Effect.gen(function* () {
      const budget = compactionRequestBudget({ contextWindow: undefined, maxTokens: 8_192 })
      const userMessage = createUserMessage({ content: [{ type: 'text', text: 'Earlier context. '.repeat(40) }], source: { kind: 'user' } })
      const chunks = yield* split({ messages: [createSystemMessage('Keep session facts.'), userMessage], maxInputBytes: budget })
      expect(chunks).toHaveLength(1)
    }),
  )
})
