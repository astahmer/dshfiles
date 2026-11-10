import assert from 'node:assert/strict'
import { test } from 'vitest'
import { API_PAYLOAD_BYTE_BUDGET, PAYLOAD_TRUNCATION_NOTE, PayloadBudget } from './payload-budget.ts'

const responseFor = (text: string) => ({ patch: text, truncated: true })

const lines = (count: number): string => Array.from({ length: count }, (_, index) => `+line ${String(index)}`).join('\n')

test('a response within the budget keeps its whole patch and is not marked truncated', () => {
  const patch = `diff --git a/a.ts b/a.ts\n${lines(200)}`

  const fitted = PayloadBudget.fitText({ text: patch, response: responseFor })

  assert.equal(fitted.truncated, false)
  assert.equal(fitted.text, patch)
  assert.equal(fitted.response.patch, patch)
})

test('a patch over the budget shrinks to the largest line-aligned prefix that still fits', () => {
  const patchLines = Array.from({ length: 200_000 }, (_, index) => `+line ${String(index)}`)
  const patch = patchLines.join('\n')

  const fitted = PayloadBudget.fitText({ text: patch, response: responseFor })

  assert.equal(fitted.truncated, true)
  assert.ok(fitted.text.endsWith(PAYLOAD_TRUNCATION_NOTE))
  assert.ok(PayloadBudget.encodedBytes(fitted.response) <= API_PAYLOAD_BYTE_BUDGET)
  const kept = fitted.text.slice(0, -PAYLOAD_TRUNCATION_NOTE.length)
  const keptLines = kept.split('\n')
  assert.ok(keptLines.length > 0)
  for (const line of keptLines) assert.match(line, /^\+line \d+$/u, 'the cut keeps whole diff lines')
  // One more line would not have fit, so this is the largest prefix rather than an arbitrary slice.
  const oneMoreLine = patchLines.slice(0, keptLines.length + 1).join('\n')
  assert.ok(PayloadBudget.encodedBytes({ patch: oneMoreLine + PAYLOAD_TRUNCATION_NOTE, truncated: true }) > API_PAYLOAD_BYTE_BUDGET)
})

test('the budget is configurable and counts the enclosing response, not just the text', () => {
  const fitted = PayloadBudget.fitText({ text: lines(200), response: text => ({ patch: text, files: ['a'.repeat(200)] }), budgetBytes: 1_000 })

  assert.equal(fitted.truncated, true)
  assert.ok(PayloadBudget.encodedBytes(fitted.response) <= 1_000)
})
