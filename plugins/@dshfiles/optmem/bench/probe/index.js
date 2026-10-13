import { appendFileSync } from 'node:fs'

export const name = '@dshfiles/optmem-bench-probe'
export const inject = ['llm']

const byteLength = value => Buffer.byteLength(JSON.stringify(value ?? null))

/**
 * Observe-only: `llm/stream` sees every model call as DSH built it (agent loop, native compaction, OptMem summaries,
 * titles); `agent/request-messages` (only dispatched when @dshfiles/request-messages is loaded) sees what full mode
 * actually sends. Message bodies are never written, only counts, sizes and provider-reported usage.
 */
export function apply(ctx, config) {
  const file = config?.file
  if (typeof file !== 'string' || file.length === 0) throw new Error('optmem-bench-probe needs config.file')
  // One agent turn runs at a time per benchmark Host, so the open agent-loop call is the one being dispatched.
  let openAgentCall
  let sequence = 0
  const described = new Set()
  const describe = async (provider, model) => {
    const key = `${provider}/${model}`
    if (described.has(key)) return
    described.add(key)
    const info = await ctx.llm.resolveModelInfo(provider, model).catch(error => ({ error: String(error) }))
    write({ kind: 'model-info', provider, model, contextWindow: info.context?.contextWindow, defaultMaxTokens: info.defaultMaxTokens, error: info.error })
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
        messages: options.messages.length,
        messageBytes: byteLength(options.messages),
        systemBytes: Buffer.byteLength(options.system ?? ''),
        // Tells native compaction summaries apart from OptMem's summarizer (both use purpose 'compaction').
        systemHead: (options.system ?? '').slice(0, 48),
        tools: options.tools?.length ?? 0,
        toolBytes: byteLength(options.tools ?? []),
      }
      return (async function* () {
        if (record.purpose === 'agent') {
          openAgentCall = record
          void describe(record.provider, record.model)
        }
        try {
          for await (const chunk of next()) {
            if (chunk.type === 'usage') record.usage = chunk.usage
            if (chunk.type === 'finish') record.finish = chunk.reason?.kind ?? String(chunk.reason)
            if (record.firstChunkMs === undefined) record.firstChunkMs = Date.now() - record.startedAt
            yield chunk
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
