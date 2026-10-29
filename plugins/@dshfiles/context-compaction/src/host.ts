import { defineHost } from '@dshfiles/dshx/host'
import { BasicCompactionEngine } from '@deepseek-ai/dsh-compaction-basic'
import type { ImageBlock } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import type {} from '@deepseek-ai/dsh-llm'
import { serializedMessageBytes, summarizeInChunks } from './chunked-summary.js'

const FALLBACK_CONTEXT_WINDOW = 32_768
const MAX_INPUT_BYTES = 64_000
const SUMMARY_PROMPT_RESERVE = 4_096
const MIN_CONTEXT_RESERVE = 4_096
const compactionConfigSchema = z.object({ maxTokens: z.number().int().positive().default(8_192) }).strict()

class ContextCompactionEngine extends BasicCompactionEngine {
  protected override summarize(
    input: Parameters<BasicCompactionEngine['summarize']>[0],
    agent: Parameters<BasicCompactionEngine['summarize']>[1],
    signal?: Parameters<BasicCompactionEngine['summarize']>[2],
  ): ReturnType<BasicCompactionEngine['summarize']> {
    return this.summarizeBounded(input, agent, signal)
  }

  private async summarizeBounded(
    input: Parameters<BasicCompactionEngine['summarize']>[0],
    agent: Parameters<BasicCompactionEngine['summarize']>[1],
    signal?: Parameters<BasicCompactionEngine['summarize']>[2],
  ): ReturnType<BasicCompactionEngine['summarize']> {
    const recentRequest = agent.session.requestHeader()?.config
    const provider = this.config.summarizationProvider || recentRequest?.provider || agent.options.provider
    const model = this.config.summarizationModel || recentRequest?.model || agent.options.model
    const modelInfo = provider === undefined || model === undefined ? undefined : await this.ctx.llm.resolveModelInfo(provider, model, signal)
    const contextWindow = modelInfo?.context?.contextWindow ?? FALLBACK_CONTEXT_WINDOW
    const reserve = Math.max(MIN_CONTEXT_RESERVE, Math.ceil(contextWindow * 0.05))
    const maxInputBytes = Math.min(MAX_INPUT_BYTES, Math.floor((contextWindow - this.config.maxTokens - reserve) / 2) - SUMMARY_PROMPT_RESERVE)
    if (maxInputBytes < 1_024) throw new Error('The selected summarization model has too little safe input capacity.')

    const imagePricing = provider === undefined || model === undefined ? undefined : this.ctx.llm.imageRequestPricing(provider, model)
    const textOnlyRoute = modelInfo?.inputModalities !== undefined && !modelInfo.inputModalities.includes('image')
    const messageBytes = (message: Parameters<BasicCompactionEngine['summarize']>[0]['messages'][number]) => {
      const images = message.content.filter((block): block is ImageBlock => block.type === 'image')
      if (images.length === 0) return serializedMessageBytes(message)
      if (imagePricing === undefined) {
        if (textOnlyRoute) return serializedMessageBytes(message)
        throw new Error('Cannot safely size an image-bearing summary without model-declared image pricing.')
      }
      const imageCost = imagePricing.priceImages(images).reduce((sum, price) => sum + price.visualTokens + serializedMessageBytes(price.text), 0)
      return serializedMessageBytes(message) + imageCost
    }

    return summarizeInChunks({
      input,
      maxInputBytes,
      messageBytes,
      ...(signal !== undefined && { signal }),
      summarize: (candidate, candidateSignal) => super.summarize(candidate, agent, candidateSignal),
    })
  }
}

export default defineHost({
  name: '@dshfiles/context-compaction',
  Config: compactionConfigSchema,
  setup(ctx, config) {
    ctx.plugin(ContextCompactionEngine, config)
  },
})
