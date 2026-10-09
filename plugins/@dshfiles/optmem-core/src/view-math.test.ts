import { describe, expect, it } from 'vitest'

import { TreeMath } from './tree-math.ts'
import type { NodeAddress } from './types.ts'
import { ViewMath } from './view-math.ts'

const leaves = (count: number): NodeAddress[] => Array.from({ length: count }, (_unused, idx) => ({ level: 0, idx }))

const allBuilt = (address: NodeAddress): string | undefined => `summary ${TreeMath.format(address)}`

const planFor = (count: number, lowerBytes: number, nodeText = allBuilt) => {
  const nodes = leaves(count)
  const lines = nodes.map(node => ViewMath.line(node, 'x'.repeat(40)))
  const bytes = lines.reduce((sum, line) => sum + ViewMath.lineBytes(line), 0)
  return ViewMath.planMergeBatch({ nodes, lines, bytes, throughPos: count, lowerBytes, nodeText })
}

describe('ViewMath', () => {
  it('renders one escaped line per node', () => {
    expect(ViewMath.line({ level: 1, idx: 3 }, 'a\nb\r\nc')).toBe('6+2| a\\nb\\nc')
    expect(ViewMath.render(['0+1| a', '1+1| b'])).toBe('0+1| a\n1+1| b\n')
    expect(ViewMath.lines('0+1| a\n1+1| b\n')).toEqual(['0+1| a', '1+1| b'])
    expect(ViewMath.lineBytes('é')).toBe(3)
  })

  it('merges the oldest most-due sibling pair first', () => {
    const nodes = leaves(8)
    expect(ViewMath.pickMergePair(nodes, 8, () => true)).toBe(0)
    expect(ViewMath.pickMergePair(nodes, 8, parent => parent.idx !== 0)).toBe(2)
    expect(ViewMath.pickMergePair([{ level: 0, idx: 1 }, { level: 0, idx: 2 }], 3, () => true)).toBe(-1)
  })

  it('brings the view under the lower bound in one batch and keeps a tiling', () => {
    const plan = planFor(200, 2_000)
    expect(plan.reachedLower).toBe(true)
    expect(plan.bytes).toBeLessThanOrEqual(2_000)
    expect(plan.bytes).toBe(plan.lines.reduce((sum, line) => sum + ViewMath.lineBytes(line), 0))
    let next = 0
    for (const node of plan.nodes) {
      expect(TreeMath.start(node)).toBe(next)
      next = TreeMath.lastPos(node) + 1
    }
    expect(next).toBe(200)
  })

  it('keeps recent lines fine-grained and coarsens older ones', () => {
    const plan = planFor(200, 2_000)
    const first = plan.nodes[0]
    const last = plan.nodes.at(-1)
    expect(first && last && first.level > last.level).toBe(true)
  })

  it('matches repeatedly picking the single most due pair', () => {
    let seed = 7
    const random = (): number => {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648
      return seed / 2_147_483_648
    }
    for (let round = 0; round < 40; round++) {
      const count = 20 + Math.floor(random() * 200)
      const built = new Set<string>()
      for (let level = 1; level < 9; level++) for (let idx = 0; idx < count; idx++) if (random() < 0.8) built.add(TreeMath.key({ level, idx }))
      const nodeText = (address: NodeAddress): string | undefined => (built.has(TreeMath.key(address)) ? `s${'y'.repeat(address.level * 3)}` : undefined)
      const nodes = leaves(count)
      const lines = nodes.map(node => ViewMath.line(node, 'x'.repeat(10 + (node.idx % 30))))
      const bytes = lines.reduce((sum, line) => sum + ViewMath.lineBytes(line), 0)
      const lowerBytes = Math.floor(bytes / (2 + random() * 6))
      const plan = ViewMath.planMergeBatch({ nodes, lines, bytes, throughPos: count, lowerBytes, nodeText })

      const naiveNodes = [...nodes]
      const naiveLines = [...lines]
      let naiveBytes = bytes
      while (naiveBytes > lowerBytes) {
        const index = ViewMath.pickMergePair(naiveNodes, count, parent => nodeText(parent) !== undefined)
        const left = naiveNodes[index]
        if (index < 0 || !left) break
        const parent = TreeMath.parent(left)
        const line = ViewMath.line(parent, nodeText(parent) ?? '')
        naiveBytes += ViewMath.lineBytes(line) - naiveLines.slice(index, index + 2).reduce((sum, removed) => sum + ViewMath.lineBytes(removed), 0)
        naiveNodes.splice(index, 2, parent)
        naiveLines.splice(index, 2, line)
      }
      expect(plan.nodes).toEqual(naiveNodes)
      expect(plan.lines).toEqual(naiveLines)
      expect(plan.bytes).toBe(naiveBytes)
    }
  })

  it('is deterministic', () => {
    expect(planFor(300, 3_000)).toEqual(planFor(300, 3_000))
  })

  it('stops above the lower bound when parents are not built yet', () => {
    const plan = planFor(16, 10, address => (address.level === 1 ? allBuilt(address) : undefined))
    expect(plan.reachedLower).toBe(false)
    expect(plan.nodes.every(node => node.level === 1)).toBe(true)
  })

  it('lists every ancestor a batch could need, limited to complete nodes', () => {
    const ancestors = ViewMath.mergeAncestors(leaves(6), 6).map(TreeMath.format)
    expect(ancestors.sort()).toEqual(['0+2', '0+4', '2+2', '4+2'].sort())
  })
})
