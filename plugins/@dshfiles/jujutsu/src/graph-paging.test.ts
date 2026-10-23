import assert from 'node:assert/strict'
import { test } from 'vitest'
import { GraphPagingModel } from './graph-paging.js'

const viewport = { scrollTop: 0, scrollHeight: 2400, clientHeight: 900 }
const deepHistory = { scrollTop: 0, scrollHeight: 40_000, clientHeight: 900 }

test('keeps eight viewports of loaded history below the viewport, with a floor for a short list', () => {
  assert.equal(GraphPagingModel.lookahead(900), 7200)
  assert.equal(GraphPagingModel.lookahead(200), 2400)
  assert.equal(GraphPagingModel.lookahead(0), 2400)
})

test('requests pages eight viewports ahead, near the end, or when nothing fills the viewport', () => {
  assert.equal(GraphPagingModel.needsAnotherPage(viewport), true)
  assert.equal(GraphPagingModel.needsAnotherPage(deepHistory), false)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 31_100, scrollHeight: 40_000, clientHeight: 900 }), false)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 31_900, scrollHeight: 40_000, clientHeight: 900 }), true)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 38_000, scrollHeight: 40_000, clientHeight: 900 }), true)
  assert.equal(GraphPagingModel.needsAnotherPage({ scrollTop: 0, scrollHeight: 300, clientHeight: 300 }), true)
})

test('tops itself up to the floor without a scroll event, even when one page already covers the viewport', () => {
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor - 1, ...deepHistory }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor, ...deepHistory }), false)
})

test('keeps loading while the loaded history leaves less than the lookahead below the viewport, then stops at the chain limit', () => {
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionFloor, ...viewport }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionLimit - 1, ...viewport }), true)
  assert.equal(GraphPagingModel.shouldLoadNextPage({ loadedRevisions: GraphPagingModel.revisionLimit, ...viewport }), false)
  // Scrolling past the limit still loads: the chain limit only bounds the automatic top-up.
  assert.equal(GraphPagingModel.needsAnotherPage(viewport), true)
})
