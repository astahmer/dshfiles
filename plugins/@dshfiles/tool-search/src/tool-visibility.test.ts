import { describe, expect, it } from 'vitest'
import { declareVisibleTools, makeToolSearchVisibility } from './tool-visibility.js'

describe('tool visibility registry', () => {
  it('keeps the first declaration of a tool and reports every name once', () => {
    const registry = makeToolSearchVisibility()
    registry.declare({ owner: '@dshfiles/html-render', tools: ['html_render', 'html_preview'], reason: 'cheap visual answer' })
    registry.declare({ owner: '@dshfiles/html-render', tools: ['html_render'], reason: 'duplicate' })

    expect([...registry.names()].sort()).toEqual(['html_preview', 'html_render'])
    expect(registry.reasons().get('html_render')).toBe('@dshfiles/html-render: cheap visual answer')
  })

  it('is optional: a Host without tool-search keeps the declaration a no-op', () => {
    expect(declareVisibleTools({ get: () => undefined }, { owner: '@dshfiles/html-render', tools: ['html_render'], reason: 'test' })).toBe(false)

    const registry = makeToolSearchVisibility()
    const declared = declareVisibleTools({ get: () => registry }, { owner: '@dshfiles/html-render', tools: ['html_render'], reason: 'test' })
    expect(declared).toBe(true)
    expect(registry.names().has('html_render')).toBe(true)
  })
})
