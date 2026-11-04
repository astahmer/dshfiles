import { describe, expect, it } from 'vitest'

import { EntityPreview, EntityRegistryModel, type EntityKind } from './entity-registry.js'

const kinds: readonly EntityKind[] = [
  { kind: 'backlog', label: 'Backlog item', order: 30, mentionPrefixes: ['b', 'backlog'] },
  { kind: 'agent', label: 'Agent', order: 10, mentionPrefixes: ['agent', 'a'] },
  { kind: 'skill', label: 'Skill', order: 20, mentionPrefixes: ['skill'] },
  { kind: 'agent', label: 'Second agent provider', order: 0 },
]

describe('EntityRegistryModel', () => {
  it('keeps the first item per kind and sorts by order', () => {
    expect(EntityRegistryModel.arrange(kinds).map(kind => `${kind.kind}:${kind.label}`)).toEqual(['agent:Agent', 'skill:Skill', 'backlog:Backlog item'])
  })

  it('names the kind whose scope a query opens, case-insensitively and only with the colon', () => {
    expect(EntityRegistryModel.scopeOwner(kinds, 'B:12')).toBe('backlog')
    expect(EntityRegistryModel.scopeOwner(kinds, 'skill:dsh')).toBe('skill')
    expect(EntityRegistryModel.scopeOwner(kinds, 'b12')).toBeUndefined()
    expect(EntityRegistryModel.scopeOwner(kinds, 'readme')).toBeUndefined()
  })

  it('tells a source when another kind owns the typed scope', () => {
    expect(EntityRegistryModel.foreignScope(kinds, 'agent', 'b:3')).toBe(true)
    expect(EntityRegistryModel.foreignScope(kinds, 'backlog', 'b:3')).toBe(false)
    expect(EntityRegistryModel.foreignScope(kinds, 'reference', 'notes')).toBe(false)
  })
})

describe('EntityPreview.decodeRequest', () => {
  const anchor = { left: 4, top: 8, width: 30, height: 12 }

  it('accepts a well-formed request with an optional range', () => {
    expect(EntityPreview.decodeRequest({ kind: 'memory', id: 't:s-1', range: '3', anchorId: 2, anchor })).toEqual({
      kind: 'memory',
      id: 't:s-1',
      range: '3',
      anchorId: 2,
      anchor,
    })
  })

  it('rejects malformed kinds, ids, anchors and coordinates', () => {
    expect(EntityPreview.decodeRequest({ kind: '', id: '1', anchorId: 1, anchor })).toBeNull()
    expect(EntityPreview.decodeRequest({ kind: 'backlog', id: '1', anchorId: 0, anchor })).toBeNull()
    expect(EntityPreview.decodeRequest({ kind: 'backlog', id: '1', anchorId: 1, anchor: { ...anchor, width: -1 } })).toBeNull()
    expect(EntityPreview.decodeRequest({ kind: 'backlog', id: 'x'.repeat(513), anchorId: 1, anchor })).toBeNull()
    expect(EntityPreview.decodeRequest('backlog:1')).toBeNull()
  })
})
