import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('queue edit uses the Host queue action instead of composer-only APIs', async () => {
  const source = await readFile(new URL('./client.tsx', import.meta.url), 'utf8')

  assert.match(source, /kind: 'edit', content: \[\{ type: 'text', text: draft \}\]/u)
  assert.match(source, /editableQueueText\(row\.content\)/u)
  assert.match(source, /<Textarea/u)
  assert.doesNotMatch(source, /beginQueueEdit|composer-based queue editing/u)
})
