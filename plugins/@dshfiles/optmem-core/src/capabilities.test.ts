import { describe, expect, it } from 'vitest'

import { Capabilities } from './capabilities.ts'
import { Scopes } from './scopes.ts'

const stockDsh = { captureEvents: true, registerTools: true, injectContext: true, replaceContext: false, resetPerTurn: false }

describe('Capabilities', () => {
  it('accepts compatibility mode on a harness without context replacement', () => {
    expect(Capabilities.validate('compatibility', stockDsh)).toEqual({ ok: true, mode: 'compatibility' })
  })

  it('reports exactly what full mode is missing', () => {
    const check = Capabilities.validate('full', stockDsh)
    expect(check.ok).toBe(false)
    if (!check.ok) expect(check.missing).toEqual(['replaceContext', 'resetPerTurn'])
  })
})

describe('Scopes', () => {
  const access = { conversationId: 'c1', projectId: 'p1', allowAllProjects: false }

  it('maps scopes to streams, falling back to the conversation without a project', () => {
    expect(Scopes.stream('project', access)).toBe('project:p1')
    expect(Scopes.stream('project', { ...access, projectId: null })).toBe('conversation:c1')
    expect(Scopes.stream('global', access)).toBe('global')
    expect(() => Scopes.stream('all-projects', access)).toThrow(/disabled/)
    expect(Scopes.stream('all-projects', { ...access, allowAllProjects: true })).toBeNull()
  })

  it('shares conversations within a project only', () => {
    expect(Scopes.canRead('conversation:c2', access, 'p1')).toBe(true)
    expect(Scopes.canRead('conversation:c3', access, 'p2')).toBe(false)
    expect(Scopes.canRead('project:p2', access, undefined)).toBe(false)
    expect(Scopes.canRead('project:p2', { ...access, allowAllProjects: true }, undefined)).toBe(true)
  })
})
