import { describe, expect, it } from 'vitest'
import { StatusStripModel, type StatusItem } from './status-strip.js'

const item = (id: string, side: StatusItem['side'], order?: number): StatusItem => {
  const base: StatusItem = { id, side, label: id, component: () => null }
  return order === undefined ? base : { ...base, order }
}

describe('status strip', () => {
  it('splits items by side and sorts each side by order, then registration', () => {
    const arranged = StatusStripModel.arrange([item('b', 'global', 2), item('t', 'thread'), item('a', 'global', 1), item('c', 'global', 2)])
    expect(arranged.global.map(entry => entry.id)).toEqual(['a', 'b', 'c'])
    expect(arranged.thread.map(entry => entry.id)).toEqual(['t'])
  })

  it('keeps one item per plugin: the first registration wins', () => {
    const arranged = StatusStripModel.arrange([item('@dshfiles/x', 'global', 5), item('@dshfiles/x', 'thread', 0)])
    expect(arranged.global.map(entry => entry.order)).toEqual([5])
    expect(arranged.thread).toEqual([])
  })
})
