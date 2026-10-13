import { appendFileSync } from 'node:fs'
import { z } from 'zod'
import { calibrationCases, calibrationVariants } from '../calibration-cases.mjs'
import { runCalibration } from '../calibration-runtime.mjs'

export const name = '@dshfiles/optmem-bench-probe'
export const inject = ['llm']

const calibrationVariantsById = new Map(calibrationVariants.map(variant => [variant.id, variant]))
const byteLength = value => Buffer.byteLength(JSON.stringify(value ?? null))
const memoryBlockMarker = 'Memory: past threads have digests and notes'
// DSH messages carry content as an array of blocks; text blocks hold the words.
const messageText = message => (Array.isArray(message.content) ? message.content.map(block => block.text ?? '').join('\n') : String(message.content ?? ''))

/**
 * Observe-only: `llm/stream` sees every model call as DSH built it (agent loop, native compaction, OptMem summaries,
 * titles); `agent/request-messages` (only dispatched when @dshfiles/request-messages is loaded) sees what full mode
 * actually sends. Message bodies are never written, only counts, sizes and provider-reported usage.
 */
export const apply = (ctx, config) => {
  const calibrationVariantIds = calibrationVariants.map(variant => variant.id)
  const settings = z
    .object({
      file: z.string().min(1),
      calibration: z.boolean().default(false),
      calibrationVariants: z.array(z.enum(calibrationVariantIds)).min(1).default(['baseline-default', 'low-effort']),
      calibrationLimit: z.number().int().min(1).max(50).default(2),
      calibrationReps: z.number().int().min(1).max(10).default(1),
    })
    .parse(config)
  const file = settings.file
  let calibrated = false
  let calibrationInProgress = false
  // One agent turn runs at a time per benchmark Host, so the open agent-loop call is the one being dispatched.
  let openAgentCall
  let sequence = 0
  const described = new Set()
  const describe = async (provider, model) => {
    const key = `${provider}/${model}`
    if (described.has(key)) return
    described.add(key)
    const info = await ctx.llm.resolveModelInfo(provider, model).catch(error => ({ error: String(error) }))
    write({
      kind: 'model-info',
      provider,
      model,
      contextWindow: info.context?.contextWindow,
      defaultMaxTokens: info.defaultMaxTokens,
      reasoning: info.reasoning,
      error: info.error,
    })
  }
  const write = record => appendFileSync(file, `${JSON.stringify(record)}\n`, { mode: 0o600 })

  ctx.on(
    'agent/request-messages',
    async (payload, next) => {
      const messages = await next()
      if (openAgentCall !== undefined) {
        openAgentCall.sentMessages = messages.length
        openAgentCall.sentBytes = byteLength(messages)
      }
      return messages
    },
    { global: true, prepend: true },
  )

  ctx.on(
    'llm/stream',
    (options, next) => {
      const record = {
        seq: ++sequence,
        startedAt: Date.now(),
        purpose: options.purpose ?? (options.toolHistory === undefined ? 'other' : 'agent'),
        sessionId: options.sessionId,
        provider: options.provider,
        model: options.model,
        maxTokens: options.maxTokens,
        reasoningEffort: options.reasoningEffort,
        messages: options.messages.length,
        messageBytes: byteLength(options.messages),
        systemBytes: Buffer.byteLength(options.system ?? ''),
        // Tells native compaction summaries apart from OptMem's summarizer (both use purpose 'compaction').
        systemHead: (options.system ?? '').slice(0, 48),
        tools: options.tools?.length ?? 0,
        toolBytes: byteLength(options.tools ?? []),
        // Where @dshfiles/memory's start block sits: how often it appears in the system field and which messages hold it.
        memoryBlock: {
          system: (options.system ?? '').split(memoryBlockMarker).length - 1,
          messages: options.messages.flatMap((message, index) => (messageText(message).includes(memoryBlockMarker) ? [`${message.role}#${index}`] : [])),
        },
      }
      if (calibrationInProgress) record.calibration = true
      return (async function* () {
        write({ ...record, kind: 'call-start' })
        if (record.purpose === 'agent') {
          openAgentCall = record
          void describe(record.provider, record.model)
        }
        try {
          for await (const chunk of next()) {
            if (chunk.type === 'usage') record.usage = chunk.usage
            if (chunk.type === 'reasoning-delta') record.reasoningTextBytes = (record.reasoningTextBytes ?? 0) + Buffer.byteLength(chunk.text)
            if (chunk.type === 'text-delta') record.answerTextBytes = (record.answerTextBytes ?? 0) + Buffer.byteLength(chunk.text)
            if (chunk.type === 'finish') {
              record.finish = chunk.reason?.kind ?? String(chunk.reason)
              if (chunk.reason?.failure !== undefined) {
                record.failureCode = chunk.reason.failure.code
                record.failureStatus = chunk.reason.failure.status
                record.providerRetryAfterMs = chunk.reason.failure.providerRetryAfterMs
              }
            }
            if (record.firstChunkMs === undefined) record.firstChunkMs = Date.now() - record.startedAt
            if (record.firstTextTokenMs === undefined && chunk.type === 'text-delta' && chunk.text.length > 0)
              record.firstTextTokenMs = Date.now() - record.startedAt
            yield chunk
          }
          if (settings.calibration && record.purpose === 'agent' && !calibrated) {
            calibrated = true
            const calibrationFile = file.replace(/\.calls\.jsonl$/, '.calibration.jsonl')
            if (calibrationFile === file) throw new Error('calibration output requires a .calls.jsonl probe path')
            calibrationInProgress = true
            try {
              await runCalibration({
                cases: calibrationCases.slice(0, settings.calibrationLimit),
                variants: settings.calibrationVariants.map(id => calibrationVariantsById.get(id)),
                repetitions: settings.calibrationReps,
                sessionId: options.sessionId,
                provider: options.provider,
                model: options.model,
                stream: call => ctx.llm.stream(call),
                write: calibrationRecord => appendFileSync(calibrationFile, `${JSON.stringify(calibrationRecord)}\n`, { mode: 0o600 }),
              })
            } catch (error) {
              appendFileSync(
                calibrationFile,
                `${JSON.stringify({ kind: 'calibration-error', errorType: error instanceof Error ? error.name : 'unknown' })}\n`,
                { mode: 0o600 },
              )
            } finally {
              calibrationInProgress = false
            }
          }
        } catch (error) {
          record.error = error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300)
          throw error
        } finally {
          record.ms = Date.now() - record.startedAt
          if (openAgentCall === record) openAgentCall = undefined
          write(record)
        }
      })()
    },
    { global: true },
  )
}
