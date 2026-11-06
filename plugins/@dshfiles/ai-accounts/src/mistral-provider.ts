import type { ThinkingLevelMap } from '@earendil-works/pi-ai'
import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral'

type MistralEffort = 'low' | 'medium' | 'high' | 'max'

/**
 * The `reasoning_effort` values Mistral accepts, per model id and its dash variants (`zai-glm-5-3` covers
 * `zai-glm-5-3-flash`). Mistral documents them at docs.mistral.ai/studio/conversations/reasoning (read 2026-11-06):
 * none of these accepts `none`, which pi-ai 1.3.0 still offers as Off on Mistral Large 4. DeepSeek V4.1 Flash is not
 * on that page; its levels are the ones a live Mistral account serves it with. Unlisted models keep pi-ai's levels.
 */
const EFFORT_GROUPS: readonly (readonly [readonly MistralEffort[], readonly string[]])[] = [
  [['low', 'medium', 'high'], ['mistral-large-4']],
  [
    ['low', 'high', 'max'],
    ['zai-glm-5-3', 'zai-glm-latest', 'deepseek-v4-1-flash'],
  ],
]

const effortsFor = (id: string): readonly MistralEffort[] | undefined =>
  EFFORT_GROUPS.find(([, ids]) => ids.some(key => id === key || id.startsWith(`${key}-`)))?.[0]

/** pi-ai's per-level wire values. `off` is unsupported, so a request without an effort omits `reasoning_effort`. */
const mistralThinkingLevelMap = (id: string): ThinkingLevelMap | undefined => {
  const efforts = effortsFor(id)
  if (efforts === undefined) return undefined
  const offered = (level: MistralEffort): string | null => (efforts.includes(level) ? level : null)
  return { off: null, minimal: null, low: offered('low'), medium: offered('medium'), high: offered('high'), xhigh: null, max: offered('max') }
}

/**
 * Which pi-ai catalog model a discovered Mistral id borrows its transport and capabilities from. Vibe plan aliases
 * (`mistral-vibe-cli-latest` → Medium 3.5, `mistral-vibe-cli-fast` → Small) are not in pi-ai's static catalog.
 */
export const mistralTemplateId = (id: string, known: readonly string[]): string | undefined => {
  if (id.startsWith('mistral-vibe-cli')) return id.includes('fast') ? 'mistral-small-latest' : 'mistral-medium-latest'
  // A dated or `-flash` variant of a catalogued model is that model.
  const base = known.filter(model => id.startsWith(`${model}-`)).sort((left, right) => right.length - left.length)[0]
  if (base !== undefined) return base
  const family = [
    ['devstral-small', 'devstral-small-2507'],
    ['devstral', 'devstral-latest'],
    ['codestral', 'codestral-latest'],
    ['magistral', 'magistral-medium-latest'],
    ['ministral', 'ministral-8b-latest'],
    ['mistral-small', 'mistral-small-latest'],
    ['mistral-large', 'mistral-large-latest'],
    ['mistral-medium', 'mistral-medium-latest'],
    ['zai-glm', 'zai-glm-5-3'],
  ].find(([prefix]) => id.startsWith(prefix ?? '\u0000'))?.[1]
  if (family !== undefined && known.includes(family)) return family
  return known.includes('mistral-medium-latest') ? 'mistral-medium-latest' : known[0]
}

/** pi-ai's Mistral provider with the efforts Mistral accepts, able to describe a model the account discovered after boot. */
export const createMistralProvider = () => {
  const provider = mistralProvider()
  const models = provider.getModels().map(model => {
    const thinkingLevelMap = mistralThinkingLevelMap(model.id)
    return thinkingLevelMap === undefined ? model : { ...model, reasoning: true, thinkingLevelMap }
  })
  return {
    ...provider,
    getModels: () => models,
    describeModel: (id: string, contextWindow?: number): (typeof models)[number] | undefined => {
      const templateId = mistralTemplateId(
        id,
        models.map(model => model.id),
      )
      const template = models.find(model => model.id === templateId)
      if (template === undefined) return undefined
      const thinkingLevelMap = mistralThinkingLevelMap(id)
      return {
        ...template,
        id,
        name: id,
        ...(thinkingLevelMap !== undefined && { reasoning: true, thinkingLevelMap }),
        ...(contextWindow !== undefined && contextWindow > 0 && { contextWindow }),
      }
    },
  }
}
