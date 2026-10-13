import { BlockAssembler, createUserMessage } from '@deepseek-ai/dsh-llm'
import { boundedSummary } from '../../optmem-core/dist/bounded-summary.js'
import { scoreProbe } from './probes.mjs'

export const runCalibration = async ({ cases, variants, sessionId, provider, model, repetitions = 1, stream, write }) => {
  for (let rep = 1; rep <= repetitions; rep++) {
    const orderedVariants = [...variants.slice((rep - 1) % variants.length), ...variants.slice(0, (rep - 1) % variants.length)]
    for (const item of cases) {
      for (const variant of orderedVariants) {
        const identity = { caseId: item.id, variant: variant.id, rep, maxBytes: item.maxBytes, reasoningEffort: variant.reasoningEffort }
        const started = Date.now()
        let physicalCalls = 0
        const totals = { inputTokens: 0, cacheReadTokens: 0, outputTokens: 0, reasoningTokens: 0 }
        write({ kind: 'calibration-start', ...identity })
        const summarizer = {
          summarize: async request => {
            const first = Math.min(16384, Math.max(variant.initialBudget, request.maxBytes * 4))
            const last = Math.max(first, Math.min(16_384, Math.min(variant.maxBudget, variant.retryBudget ?? first * 2)))
            const budgets = last > first ? [first, last] : [first]
            for (const maxTokens of budgets) {
              const assembler = new BlockAssembler()
              const textMetrics = { reasoningTextBytes: 0, answerTextBytes: 0 }
              const call = {
                provider,
                model,
                sessionId,
                system: variant.instructions(request),
                messages: [
                  createUserMessage({
                    content: [
                      {
                        type: 'text',
                        text:
                          request.kind === 'leaf'
                            ? `Record (JSON string):\n${JSON.stringify(request.input[0] ?? '')}`
                            : `Notes (JSON array, older first):\n${JSON.stringify(request.input)}`,
                      },
                    ],
                    source: { kind: 'user' },
                  }),
                ],
                maxTokens,
                purpose: 'compaction',
                signal: AbortSignal.timeout(60000),
              }
              if (variant.reasoningEffort !== undefined) call.reasoningEffort = variant.reasoningEffort
              physicalCalls++
              write({
                kind: 'calibration-call-start',
                ...identity,
                physicalCall: physicalCalls,
                maxTokens,
                attempt: request.attempt,
                requestedBytes: request.maxBytes,
              })
              for await (const chunk of stream(call)) {
                if (chunk.type === 'reasoning-delta') textMetrics.reasoningTextBytes += Buffer.byteLength(chunk.text)
                if (chunk.type === 'text-delta') textMetrics.answerTextBytes += Buffer.byteLength(chunk.text)
                assembler.push(chunk)
              }
              const usage = assembler.usage
              for (const key of Object.keys(totals)) totals[key] += usage?.[key] ?? 0
              const text = assembler
                .blocks()
                .filter(block => block.type === 'text')
                .map(block => block.text)
                .join('')
                .trim()
              const finish = assembler.finish
              write({
                kind: 'calibration-call-end',
                ...identity,
                physicalCall: physicalCalls,
                maxTokens,
                finish: finish.kind,
                answerBytes: Buffer.byteLength(text),
                ...textMetrics,
                usage,
              })
              if (finish.kind === 'max-tokens' && maxTokens < last) continue
              if (finish.kind !== 'stop' || text.length === 0)
                throw new Error(`calibration summary ended ${finish.kind} with ${Buffer.byteLength(text)} answer bytes`)
              return { text, model: `${provider}/${model}` }
            }
            throw new Error('calibration exhausted its bounded token budgets')
          },
        }
        try {
          const result = await boundedSummary({
            summarizer,
            logger: { warn: (message, fields) => write({ kind: 'calibration-warning', ...identity, message, fields }) },
            kind: item.kind,
            stream: `conversation:${sessionId}`,
            conversationId: sessionId,
            address: '0+1',
            input: item.input,
            maxBytes: item.maxBytes,
            retries: 3,
          })
          const scored = scoreProbe({ answer: result.text, probe: { id: item.id, expect: item.expect, forbid: item.forbid }, truth: {} })
          write({
            kind: 'calibration-end',
            ...identity,
            physicalCalls,
            usage: totals,
            ms: Date.now() - started,
            text: result.text,
            bytes: Buffer.byteLength(result.text),
            clipped: result.clipped,
            quality: scored,
            complete: true,
          })
        } catch (error) {
          write({
            kind: 'calibration-end',
            ...identity,
            physicalCalls,
            usage: totals,
            ms: Date.now() - started,
            complete: false,
            error: error instanceof Error ? error.message : 'unknown calibration error',
          })
        }
      }
    }
  }
}
