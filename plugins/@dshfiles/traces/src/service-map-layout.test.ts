import { describe, expect, test } from 'vitest'
import { ServiceMapLayout } from './service-map-layout.js'

describe('service map layout', () => {
  test('places callers left of callees by the longest call chain', () => {
    const placed = ServiceMapLayout.layout(
      ['web', 'payments', 'db', 'cache'],
      [
        { source: 'web', target: 'payments' },
        { source: 'payments', target: 'db' },
        { source: 'web', target: 'db' },
        { source: 'web', target: 'cache' },
      ],
    )
    expect(Object.fromEntries(placed.nodes.map(node => [node.service, [node.column, node.row]]))).toEqual({
      cache: [1, 0],
      db: [2, 0],
      payments: [1, 1],
      web: [0, 0],
    })
    expect(placed).toMatchObject({ columns: 3, rows: 2 })
  })

  test('terminates on a cycle and keeps isolated services', () => {
    const placed = ServiceMapLayout.layout(
      ['a', 'b', 'lonely'],
      [
        { source: 'a', target: 'b' },
        { source: 'b', target: 'a' },
      ],
    )
    expect(placed.nodes.map(node => node.service)).toEqual(['a', 'b', 'lonely'])
    expect(Math.max(...placed.nodes.map(node => node.column))).toBeLessThanOrEqual(2)
  })
})
