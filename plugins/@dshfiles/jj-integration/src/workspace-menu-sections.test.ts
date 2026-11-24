import { describe, expect, it } from 'vitest'
import { arrangeWorkspaceMenuSections, type WorkspaceMenuSection } from './workspace-menu-sections.js'

const section = (id: string, order?: number): WorkspaceMenuSection => {
  const Component = (): null => null
  return order === undefined ? { id, Component } : { id, order, Component }
}

describe('workspace menu sections', () => {
  it('keeps one section per id and sorts by order, then by registration', () => {
    const arranged = arrangeWorkspaceMenuSections([section('@a/late', 20), section('@a/first', 5), section('@a/late', 1), section('@a/unordered')])
    expect(arranged.map(entry => entry.id)).toEqual(['@a/unordered', '@a/first', '@a/late'])
  })
})
