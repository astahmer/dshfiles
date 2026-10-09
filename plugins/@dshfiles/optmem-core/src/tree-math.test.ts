import { describe, expect, it } from 'vitest'

import { TreeMath } from './tree-math.ts'

describe('TreeMath', () => {
  it('maps (level, idx) to the "start+len" covering range and back', () => {
    expect(TreeMath.format({ level: 3, idx: 5 })).toBe('40+8')
    expect(TreeMath.parse('40+8')).toEqual({ level: 3, idx: 5 })
    expect(TreeMath.parse('7+1')).toEqual({ level: 0, idx: 7 })
    expect(TreeMath.lastPos({ level: 3, idx: 5 })).toBe(47)
  })

  it('rejects addresses that are not tree nodes', () => {
    expect(TreeMath.parse('40+6')).toBeUndefined()
    expect(TreeMath.parse('4+8')).toBeUndefined()
    expect(TreeMath.parse('0+0')).toBeUndefined()
    expect(TreeMath.parse('abc')).toBeUndefined()
  })

  it('navigates parent, children and siblings', () => {
    expect(TreeMath.parent({ level: 0, idx: 5 })).toEqual({ level: 1, idx: 2 })
    expect(TreeMath.children({ level: 2, idx: 1 })).toEqual([
      { level: 1, idx: 2 },
      { level: 1, idx: 3 },
    ])
    expect(TreeMath.children({ level: 0, idx: 1 })).toBeUndefined()
    expect(TreeMath.sibling({ level: 1, idx: 3 })).toEqual({ level: 1, idx: 2 })
    expect(TreeMath.areSiblings({ level: 1, idx: 2 }, { level: 1, idx: 3 })).toBe(true)
    expect(TreeMath.areSiblings({ level: 1, idx: 1 }, { level: 1, idx: 2 })).toBe(false)
    expect(TreeMath.areSiblings({ level: 1, idx: 2 }, { level: 0, idx: 6 })).toBe(false)
  })

  it('only treats fully covered nodes as complete', () => {
    expect(TreeMath.isComplete({ level: 2, idx: 1 }, 8)).toBe(true)
    expect(TreeMath.isComplete({ level: 2, idx: 1 }, 7)).toBe(false)
  })

  it('measures due from the pair end so older and coarser pairs are less urgent', () => {
    const recentLeaves = TreeMath.due({ level: 0, lastPos: 98, throughPos: 100 })
    const olderLeaves = TreeMath.due({ level: 0, lastPos: 60, throughPos: 100 })
    const olderCoarse = TreeMath.due({ level: 3, lastPos: 60, throughPos: 100 })
    expect(olderLeaves).toBeGreaterThan(recentLeaves)
    expect(olderLeaves).toBeGreaterThan(olderCoarse)
  })

  it('finds the view node covering a position', () => {
    const nodes = [
      { level: 2, idx: 0 },
      { level: 1, idx: 2 },
      { level: 0, idx: 6 },
    ]
    expect(TreeMath.covering(nodes, 3)).toBe(0)
    expect(TreeMath.covering(nodes, 5)).toBe(1)
    expect(TreeMath.covering(nodes, 6)).toBe(2)
    expect(TreeMath.covering(nodes, 7)).toBe(-1)
  })
})
