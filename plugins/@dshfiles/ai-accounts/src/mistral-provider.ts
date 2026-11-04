import { mistralProvider } from '@earendil-works/pi-ai/providers/mistral'

/**
 * Which pi-ai catalog model a discovered Mistral id borrows its transport and capabilities from. Vibe plan aliases
 * (`mistral-vibe-cli-latest` → Medium 3.5, `mistral-vibe-cli-fast` → Small) are not in pi-ai's static catalog.
 */
export const mistralTemplateId = (id: string, known: readonly string[]): string | undefined => {
  if (id.startsWith('mistral-vibe-cli')) return id.includes('fast') ? 'mistral-small-latest' : 'mistral-medium-latest'
  const family = [
    ['devstral-small', 'devstral-small-2507'],
    ['devstral', 'devstral-latest'],
    ['codestral', 'codestral-latest'],
    ['magistral', 'magistral-medium-latest'],
    ['ministral', 'ministral-8b-latest'],
    ['mistral-small', 'mistral-small-latest'],
    ['mistral-large', 'mistral-large-latest'],
    ['mistral-medium', 'mistral-medium-latest'],
  ].find(([prefix]) => id.startsWith(prefix ?? '\u0000'))?.[1]
  if (family !== undefined && known.includes(family)) return family
  return known.includes('mistral-medium-latest') ? 'mistral-medium-latest' : known[0]
}

/** pi-ai's Mistral provider, able to describe a model the account's catalog discovered after boot. */
export const createMistralProvider = () => {
  const provider = mistralProvider()
  const models = provider.getModels()
  return {
    ...provider,
    describeModel: (id: string, contextWindow?: number): (typeof models)[number] | undefined => {
      const templateId = mistralTemplateId(
        id,
        models.map(model => model.id),
      )
      const template = models.find(model => model.id === templateId)
      if (template === undefined) return undefined
      return { ...template, id, name: id, ...(contextWindow !== undefined && contextWindow > 0 && { contextWindow }) }
    },
  }
}
