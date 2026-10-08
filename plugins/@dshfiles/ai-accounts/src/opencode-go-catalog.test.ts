import { describe, expect, it } from 'vitest'
import { parseOpenCodeGoCatalog } from './opencode-go-catalog.js'

describe('OpenCode Go catalog response', () => {
  it('reads current model IDs and removes duplicate entries', () => {
    expect(
      parseOpenCodeGoCatalog({
        object: 'list',
        data: [{ id: 'step-5-preview-free' }, { id: 'deepseek-v4-flash' }, { id: 'step-5-preview-free' }],
      }),
    ).toEqual(['step-5-preview-free', 'deepseek-v4-flash'])
  })

  it('rejects unexpected catalog shapes', () => {
    expect(() => parseOpenCodeGoCatalog({ data: [{ name: 'missing id' }] })).toThrow()
  })
})
