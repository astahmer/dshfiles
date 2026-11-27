import { describe, expect, it } from 'vitest'
import { LabelLanguages, namespaceLabelOf, type BundleLabel } from './bundle-labels.js'

const namespaceLabelsFor = LabelLanguages.trim
const languageChainOf = LabelLanguages.chainOf

const english = (text: NonNullable<BundleLabel['title']>): string => (typeof text === 'string' ? text : text.en)
const chinese = (text: NonNullable<BundleLabel['title']>): string => (typeof text === 'string' ? text : (text.zh ?? text.en))

// Rows as the scratch Host reports them (2026-11-16): an owned plugin with a locale file, one without, and two DSH
// core rows whose generated locale files only restate the row id and the package description.
const authored: BundleLabel = {
  rowId: 'queue-reorder',
  moduleName: '@dshfiles/queue-reorder',
  bundleName: '@dshfiles/queue-reorder',
  title: { en: 'Queue Reorder' },
  description: { en: 'Drag queued messages to change the order they run in.' },
  bundleDescription: 'Reorder the queued-message dock by dragging.',
}
const packageOnly: BundleLabel = {
  rowId: 'dshfiles-editor',
  moduleName: '@dshfiles/editor',
  bundleName: '@dshfiles/editor',
  title: '@dshfiles/editor',
  description: 'Monaco file editor for DSH: workspace file tree, tabs, open-from-anywhere and confined saving.',
  bundleDescription: 'Monaco file editor for DSH: workspace file tree, tabs, open-from-anywhere and confined saving.',
}
const coreRow: BundleLabel = {
  rowId: 'subagent-model-selection-settings',
  moduleName: '@deepseek-ai/dsh-tool-subagent/model-selection-settings',
  bundleName: '@deepseek-ai/dsh-web-app',
  title: { en: 'tool-subagent/model-selection-settings', zh: '子代理模型选择设置' },
  description: {
    en: 'The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin',
    zh: 'dsh 浏览器界面包',
  },
  bundleDescription: 'The dsh browser-surface bundle: the web patch layer over dsh-base plus the runtime glue plugin',
}
const untitled: BundleLabel = {
  rowId: 'llm-deepseek-account',
  moduleName: '@deepseek-ai/dsh-llm-deepseek-account',
  bundleName: '@deepseek-ai/dsh-base',
  bundleDescription: 'The dsh base bundle.',
}

/** Core `LocaleRuntime.resolveText`: the chain's entries win right to left over the `en` fallback. */
const coreResolve =
  (chain: readonly string[]) =>
  (text: NonNullable<BundleLabel['title']>): string =>
    typeof text === 'string' ? text : chain.reduceRight<string>((resolved, locale) => text[locale.toLowerCase()] ?? resolved, text.en)

const eightLanguages = (english: string): NonNullable<BundleLabel['title']> => ({
  en: english,
  zh: `${english} 中文`,
  ja: `${english} 日本語`,
  es: `${english} en español`,
  fr: `${english} en français`,
  de: `${english} auf Deutsch`,
  ru: `${english} по-русски`,
  pt: `${english} em português`,
})
const translated: BundleLabel = {
  rowId: 'dshfiles-memory',
  moduleName: '@dshfiles/memory',
  bundleName: '@dshfiles/memory',
  official: false,
  title: eightLanguages('Memory'),
  description: eightLanguages('Digests and notes of earlier threads, searchable by the agent.'),
  bundleDescription: 'Thread digests, notes and search for DSH.',
}

describe('namespaceLabelsFor', () => {
  const rows = [authored, packageOnly, coreRow, untitled, translated]
  const chains = [['en'], ['zh', 'en'], ['fr', 'en'], ['pt-br', 'pt', 'en']] as const

  it('resolves every row to the same Settings title and description in each language chain', () => {
    for (const chain of chains) {
      const trimmed = namespaceLabelsFor(rows, chain)
      expect(trimmed.map(row => namespaceLabelOf(row, coreResolve(chain)))).toEqual(rows.map(row => namespaceLabelOf(row, coreResolve(chain))))
      expect(trimmed.map(row => [row.rowId, row.bundleName, row.official])).toEqual(rows.map(row => [row.rowId, row.bundleName, row.official]))
    }
  })

  it('keeps only the chain languages, no package description and no unshown description', () => {
    const [memory] = namespaceLabelsFor([translated], ['fr', 'en'])
    expect(memory?.title).toEqual({ en: 'Memory', fr: 'Memory en français' })
    expect(memory?.description).toEqual({ en: 'Digests and notes of earlier threads, searchable by the agent.', fr: 'Digests and notes of earlier threads, searchable by the agent. en français' })
    expect(memory).not.toHaveProperty('bundleDescription')
    const [core] = namespaceLabelsFor([coreRow], ['zh', 'en'])
    expect(core).not.toHaveProperty('description')
  })

  it('sends under a third of the bytes for a one-language reader', () => {
    const many = Array.from({ length: 40 }, (_, index) => ({ ...translated, rowId: `row-${String(index)}` }))
    expect(JSON.stringify(namespaceLabelsFor(many, ['en'])).length).toBeLessThan(JSON.stringify(many).length / 3)
  })
})

describe('languageChainOf', () => {
  it('follows the active locale fallback chain to English the way core resolves text', () => {
    const locales = [
      { id: 'en' },
      { id: 'zh', fallback: 'en' },
      { id: 'pt', fallback: 'en' },
      { id: 'pt-BR', fallback: 'pt' },
    ]
    expect(languageChainOf({ active: 'en', locales })).toEqual(['en'])
    expect(languageChainOf({ active: 'zh', locales })).toEqual(['zh', 'en'])
    expect(languageChainOf({ active: 'pt-BR', locales })).toEqual(['pt-br', 'pt', 'en'])
    expect(languageChainOf({ active: 'xx', locales })).toEqual(['en'])
    expect(languageChainOf({ active: 'a', locales: [{ id: 'a', fallback: 'b' }, { id: 'b', fallback: 'a' }] })).toEqual(['a', 'b', 'en'])
  })
})

describe('namespaceLabelOf', () => {
  it('keeps the title and description a manifest wrote for people', () => {
    expect(namespaceLabelOf(authored, english)).toEqual({
      title: 'Queue Reorder',
      description: 'Drag queued messages to change the order they run in.',
    })
  })

  it('never shows a package description as a section description', () => {
    expect(namespaceLabelOf(packageOnly, english)).toEqual({ title: '', description: '' })
    expect(namespaceLabelOf(untitled, english).description).toBe('')
  })

  it('drops the description of a row whose manifest only restates its id, in every language', () => {
    expect(namespaceLabelOf(coreRow, english).description).toBe('')
    expect(namespaceLabelOf(coreRow, chinese).description).toBe('')
  })
})
