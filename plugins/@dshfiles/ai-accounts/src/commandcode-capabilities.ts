import { offloadedImageText, textOnlyImageText, type ImageBlock, type LlmImageRequestPrice, type LlmImageRequestPricing } from '@deepseek-ai/dsh-llm'
import type { ThinkingLevelMap } from '@earendil-works/pi-ai'

/**
 * What each Command Code model can do: its selectable reasoning efforts, whether
 * it reads images, and what an image costs it in visual tokens.
 *
 * Ported from @mars-sea/dsh-commandcode-provider 0.12.3 (MIT, Copyright (c) 2026
 * Mars-Sea), itself partly ported from pi-commandcode-provider (MIT, Copyright
 * (c) 2025 Pat Woz). Its tables mirror the official `command-code@1.74.1` CLI
 * model table; see ../NOTICE. Keep them in step with that CLI when models ship.
 */

type CliEffort = 'off' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/** Grouped by effort list so a new model is one line, not a new block. */
const EFFORT_GROUPS: readonly (readonly [readonly CliEffort[], readonly string[]])[] = [
  [
    ['low', 'medium', 'high', 'xhigh', 'max'],
    [
      'claude-fable-5-1',
      'claude-fable-5',
      'claude-opus-4-7',
      'claude-opus-4-8',
      'claude-opus-5',
      'claude-opus-5-5',
      'claude-sonnet-4-6',
      'claude-sonnet-5',
      'claude-sonnet-5-5',
      'gpt-5.6-luna',
      'gpt-5.6-sol',
      'gpt-5.6-terra',
      'gpt-6-astra',
      'gpt-6-luna',
      'gpt-6-sol',
      'gpt-6.1-sol',
      'meta/muse-spark-1.3',
    ],
  ],
  [
    ['low', 'medium', 'high', 'xhigh'],
    [
      'gpt-5.3-codex',
      'gpt-5.4',
      'gpt-5.5',
      'xai/grok-4.6',
      'xai/grok-4.7',
      'meta/muse-spark-1.1',
      'meta/muse-spark-1.2',
      'meta/muse-spark-1.2-contributor',
      'meta/muse-spark-1.3-contributor',
    ],
  ],
  [
    ['low', 'medium', 'high'],
    [
      'google/gemini-3.1-flash-lite',
      'google/gemini-3.5-flash',
      'google/gemini-3.5-flash-lite',
      'google/gemini-3.6-flash',
      'google/gemini-3.7-flash',
      'google/gemini-3.8-flash',
      'gpt-5.4-mini',
      'stepfun/Step-5-Preview',
      'tencent/hy4-preview',
      'xai/grok-4.5',
      'MiniMaxAI/MiniMax-M3',
      'inclusionai/ling-3.1-flash:free',
    ],
  ],
  [['low', 'medium', 'high', 'max'], ['stealth/space-bunny-alpha']],
  [
    ['low', 'medium', 'xhigh'],
    ['Qwen/Qwen3.8-Max', 'Qwen/Qwen3.8-Max-0902', 'Qwen/Qwen3.8-27B', 'Qwen/Qwen3.8-Flash', 'Qwen/Qwen3.8-Omni-Flash'],
  ],
  [
    ['low', 'high', 'max'],
    ['deepseek/deepseek-v4-flash-fast', 'moonshotai/Kimi-K3', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.3-flashx', 'zai-org/GLM-5.3'],
  ],
  [
    ['off', 'low', 'high', 'max'],
    ['deepseek/deepseek-v4.1-flash', 'deepseek/deepseek-v4.1-flash-fast'],
  ],
  [
    ['off', 'high', 'max'],
    ['deepseek/deepseek-v4-flash', 'deepseek/deepseek-v4-flash-vision-exp', 'deepseek/deepseek-v4-pro'],
  ],
  [['high', 'xhigh'], ['sakana/fugu-ultra']],
  [['high', 'max'], ['zai-org/GLM-5.2']],
]

const EFFORTS = new Map<string, readonly CliEffort[]>(EFFORT_GROUPS.flatMap(([efforts, ids]) => ids.map(id => [id, efforts] as const)))

const IMAGE_MODELS = new Set([
  'MiniMaxAI/MiniMax-M3',
  'Qwen/Qwen3.6-Plus',
  'Qwen/Qwen3.7-Flash',
  'Qwen/Qwen3.7-Plus',
  'Qwen/Qwen3.8-27B',
  'Qwen/Qwen3.8-Flash',
  'Qwen/Qwen3.8-Max',
  'Qwen/Qwen3.8-Max-0902',
  'Qwen/Qwen3.8-Omni-Flash',
  'claude-fable-5-1',
  'claude-fable-5',
  'claude-haiku-4-5-20251001',
  'claude-opus-4-7',
  'claude-opus-4-8',
  'claude-opus-5-5',
  'claude-opus-5',
  'claude-sonnet-4-6',
  'claude-sonnet-5',
  'claude-sonnet-5-5',
  'deepseek/deepseek-v4-flash-vision-exp',
  'deepseek/deepseek-v4.1-flash',
  'deepseek/deepseek-v4.1-flash-fast',
  'google/gemini-3.1-flash-lite',
  'google/gemini-3.5-flash',
  'google/gemini-3.5-flash-lite',
  'google/gemini-3.6-flash',
  'google/gemini-3.7-flash',
  'google/gemini-3.8-flash',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
  'gpt-5.5',
  'gpt-5.6-luna',
  'gpt-5.6-sol',
  'gpt-5.6-terra',
  'gpt-6-astra',
  'gpt-6-luna',
  'gpt-6-sol',
  'gpt-6.1-sol',
  'meta/muse-spark-1.1',
  'meta/muse-spark-1.2',
  'meta/muse-spark-1.2-contributor',
  'meta/muse-spark-1.3',
  'meta/muse-spark-1.3-contributor',
  'moonshotai/Kimi-K2.5',
  'moonshotai/Kimi-K2.6',
  'moonshotai/Kimi-K2.7-Code',
  'moonshotai/Kimi-K2.7-Code-Highspeed',
  'moonshotai/Kimi-K3',
  'sakana/fugu-ultra',
  'stealth/space-bunny-alpha',
  'stepfun/Step-3.7-Flash',
  'stepfun/Step-5-Preview',
  'thinkingmachines/inkling',
  'thinkingmachines/inkling-small',
  'xai/grok-4.5',
  'xai/grok-4.6',
  'xai/grok-4.7',
  'xiaomi/mimo-v2.5',
  'xiaomi/mimo-v2.6-flash',
  'xiaomi/mimo-v2.6-pro',
  'xiaomi/mimo-v2.6-pro-ultraspeed',
  'z-ai/glm-5.3-flash',
  'z-ai/glm-5.3-flashx',
])

/** Output ceilings below the 131 072 the CLI asks for by default; a request above one is refused with a 400. */
const OUTPUT_CEILINGS = new Map<string, number>([
  ['claude-haiku-4-5-20251001', 64_000],
  ['google/gemini-3.1-flash-lite', 65_536],
  ['google/gemini-3.5-flash', 65_536],
  ['google/gemini-3.5-flash-lite', 65_536],
  ['google/gemini-3.6-flash', 65_536],
  ['google/gemini-3.7-flash', 65_536],
  ['google/gemini-3.8-flash', 65_536],
  ['inclusionai/ling-3.0-flash-sante:free', 32_768],
  ['inclusionai/ling-3.1-flash:free', 32_768],
  ['nvidia/nemotron-3-ultra-550b-a55b', 65_536],
  ['poolside/laguna-s-2.1-free', 32_768],
  ['Qwen/Qwen3.6-Max-Preview', 65_536],
  ['Qwen/Qwen3.6-Plus', 65_536],
  ['stepfun/Step-5-Preview', 65_536],
  ['thinkingmachines/inkling', 65_536],
])

/** The server caps `max_tokens` at 200 000 for every model; 131 072 keeps a margin under it. */
const DEFAULT_MAX_OUTPUT_TOKENS = 131_072

/** The CLI's own image request target: long edge 1568 px. */
const REQUEST_IMAGE_MAX_LONG_EDGE = 1568

interface Size {
  readonly width: number
  readonly height: number
}

const scaleBy = (size: Size, factor: number): Size => ({
  width: Math.max(1, Math.round(size.width * factor)),
  height: Math.max(1, Math.round(size.height * factor)),
})

const longEdge = (size: Size, edge: number): Size => {
  if (!Number.isFinite(size.width) || !Number.isFinite(size.height) || size.width <= 0 || size.height <= 0) {
    return { width: Math.max(1, Math.round(size.width) || 1), height: Math.max(1, Math.round(size.height) || 1) }
  }
  const longest = Math.max(size.width, size.height)
  return edge >= longest ? size : scaleBy(size, edge / longest)
}

const anthropicTokens = (size: Size): number => {
  const projected = longEdge(size, REQUEST_IMAGE_MAX_LONG_EDGE)
  return Math.max(1, Math.ceil((projected.width * projected.height) / 750))
}

const openAiTokens = (size: Size): number => {
  let scaled: Size = { width: Math.max(1, size.width), height: Math.max(1, size.height) }
  const longest = Math.max(scaled.width, scaled.height)
  if (longest > 2048) scaled = scaleBy(scaled, 2048 / longest)
  const shortest = Math.min(scaled.width, scaled.height)
  if (shortest > 768) scaled = scaleBy(scaled, 768 / shortest)
  return 85 + 170 * (Math.ceil(scaled.width / 512) * Math.ceil(scaled.height / 512))
}

const googleTokens = (size: Size): number => (size.width <= 384 && size.height <= 384 ? 258 : 258 * Math.ceil(size.width / 768) * Math.ceil(size.height / 768))

/** DeepSeek-VL: 14 px patches, 3x downsample, at least 295 936 px, at most 1024 tokens. */
const deepSeekGridTokens = (size: Size): number => {
  const cells = (length: number): number => Math.ceil(Math.ceil(length / 14) / 3)
  return cells(size.height) * (cells(size.width) + 1) + 2
}

const deepSeekTokens = (size: Size): number => {
  let scaled: Size = { width: Math.max(1, size.width), height: Math.max(1, size.height) }
  const pixels = scaled.width * scaled.height
  if (pixels < 295_936) scaled = scaleBy(scaled, Math.sqrt(295_936 / pixels))
  const direct = deepSeekGridTokens(scaled)
  if (direct <= 1024) return direct
  let low = 0
  let high = 1
  let best = direct
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2
    const tokens = deepSeekGridTokens(scaleBy(scaled, mid))
    if (tokens <= 1024) {
      low = mid
      best = tokens
    } else {
      high = mid
    }
  }
  return best
}

const imageTokens = (modelId: string, size: Size): number => {
  const id = modelId.toLowerCase()
  const vendor = id.includes('/') ? id.slice(0, id.indexOf('/')) : ''
  if (id.startsWith('claude')) return anthropicTokens(size)
  if (id.startsWith('gpt') || /^o[1-9]/.test(id)) return openAiTokens(size)
  if (vendor === 'google' || id.startsWith('gemini')) return googleTokens(size)
  if (vendor === 'deepseek') return deepSeekTokens(size)
  return Math.max(anthropicTokens(size), openAiTokens(size), googleTokens(size))
}

export class CommandCodeCapabilities {
  static readsImages(modelId: string): boolean {
    return IMAGE_MODELS.has(modelId)
  }

  /** An unlisted Claude model gets 64 000, the Claude family's lowest ceiling. */
  static maxOutputTokens(modelId: string): number {
    return OUTPUT_CEILINGS.get(modelId) ?? (modelId.startsWith('claude') && !EFFORTS.has(modelId) ? 64_000 : DEFAULT_MAX_OUTPUT_TOKENS)
  }

  /**
   * pi-ai's per-level wire values, or undefined for a model with no selectable
   * effort. `off` stays selectable everywhere because DSH sends it by omitting
   * the field; only levels the CLI does not list are marked unsupported.
   */
  static thinkingLevelMap(modelId: string): ThinkingLevelMap | undefined {
    const efforts = EFFORTS.get(modelId)
    if (efforts === undefined) return undefined
    const offered = (level: CliEffort): string | null => (efforts.includes(level) ? level : null)
    return {
      minimal: null,
      low: offered('low'),
      medium: offered('medium'),
      high: offered('high'),
      ...(efforts.includes('xhigh') && { xhigh: 'xhigh' }),
      ...(efforts.includes('max') && { max: 'max' }),
    }
  }

  /** Visual tokens at the size the CLI sends, priced by the model's vendor family. */
  static imageRequestPricing(modelId: string): LlmImageRequestPricing {
    const readsImages = IMAGE_MODELS.has(modelId)
    return {
      priceImages: (images: readonly ImageBlock[]): readonly LlmImageRequestPrice[] =>
        images.map(image => {
          if (!readsImages) return { visualTokens: 0, text: textOnlyImageText(image.attachment) }
          if (image.offloaded === true) return { visualTokens: 0, text: offloadedImageText(image.attachment) }
          return { visualTokens: imageTokens(modelId, longEdge(image.attachment, REQUEST_IMAGE_MAX_LONG_EDGE)), text: '' }
        }),
    }
  }
}
