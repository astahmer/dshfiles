import { describe, expect, it } from 'vitest'
import { initialProjectParent } from './project-defaults.js'

describe('initialProjectParent', () => {
  it('prefers the remembered parent folder', () => {
    expect(initialProjectParent({ defaultParent: '/Users/me/dev', home: '/Users/me' })).toBe('/Users/me/dev')
  })

  it('falls back to the Host home when nothing is remembered', () => {
    expect(initialProjectParent({ defaultParent: '', home: '/Users/me' })).toBe('/Users/me')
    expect(initialProjectParent({ defaultParent: '   ', home: '/Users/me' })).toBe('/Users/me')
    expect(initialProjectParent({ home: '/Users/me' })).toBe('/Users/me')
  })

  it('has a placeholder when the Host reports no home', () => {
    expect(initialProjectParent({})).toBe('~/')
  })
})
