import assert from 'node:assert/strict'
import { test } from 'vitest'
import { GraphRowAnchorModel, type GraphRowAnchor } from './graph-row-anchor.js'

const anchor = (overrides: Partial<GraphRowAnchor> = {}): GraphRowAnchor => ({
  commitId: 'a1b2c3',
  top: 240,
  viewportHeight: 640,
  rowHeight: 28,
  ...overrides,
})

test('a fully visible row keeps its top when the row above it collapses', () => {
  // The click landed at 240px; collapsing the row above moved it to 96px, so the list scrolls by -144 to hold it.
  assert.equal(GraphRowAnchorModel.scrollDelta({ anchor: anchor(), currentTop: 96 }), -144)
  assert.equal(GraphRowAnchorModel.scrollDelta({ anchor: anchor(), currentTop: 240 }), 0)
})

test('a row cut by the fold comes to the top of the viewport instead of tucking its panel above it', () => {
  assert.equal(GraphRowAnchorModel.scrollDelta({ anchor: anchor({ top: -40 }), currentTop: -40 }), -40)
  assert.equal(GraphRowAnchorModel.scrollDelta({ anchor: anchor({ top: 630 }), currentTop: 630 }), 630)
})

test('sub-pixel measurements do not scroll, so a settling row cannot jitter the list', () => {
  assert.equal(GraphRowAnchorModel.shouldScroll(0), false)
  assert.equal(GraphRowAnchorModel.shouldScroll(0.6), false)
  assert.equal(GraphRowAnchorModel.shouldScroll(1), true)
  assert.equal(GraphRowAnchorModel.shouldScroll(-2), true)
})
