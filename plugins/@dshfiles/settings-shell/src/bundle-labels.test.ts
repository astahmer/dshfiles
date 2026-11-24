import { describe, expect, it } from 'vitest'
import { namespaceLabelOf, type BundleLabel } from './bundle-labels.js'

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
