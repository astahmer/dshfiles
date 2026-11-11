import { describe, expect, it } from 'vitest'

import { itemCopyEntries } from './item-copy-entries.js'

const item = { id: 316, ref: 'am11', title: 'Group copy actions', kind: 'task', status: 'doing', project: null, tags: [], links: [] } as const

describe('itemCopyEntries', () => {
  it('offers item ID, link and Markdown for one item, copying its reference forms', () => {
    const entries = itemCopyEntries({ item, selection: [item] })

    expect(entries.map(entry => entry.label)).toEqual(['Item ID', 'Link', 'Markdown'])
    expect(entries.map(entry => entry.text())).toEqual(['am11', 'b:am11', expect.stringContaining('`b:am11`')])
  })

  it('pluralizes and joins the whole selection', () => {
    const entries = itemCopyEntries({ item, selection: [item, { id: 2, ref: 'k3f9' }] })

    expect(entries.map(entry => entry.label)).toEqual(['Item IDs', 'Links', 'Markdown'])
    expect(entries[0]?.text()).toBe('am11, k3f9')
    expect(entries[1]?.text()).toBe('b:am11 b:k3f9')
  })
})
