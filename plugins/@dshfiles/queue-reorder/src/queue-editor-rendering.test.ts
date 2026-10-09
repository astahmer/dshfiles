import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('queue edit delegates draft ownership to the shared composer', async () => {
  const source = await readFile(new URL('./client.tsx', import.meta.url), 'utf8')

  assert.match(source, /props\.useInput\(state => state\.queueEdit\)/u)
  assert.match(source, /inputActions\.beginQueueEdit\(row\.id\)/u)
  assert.match(source, /hasQueueEditInputActions\(inputActions\)/u)
  assert.doesNotMatch(source, /QueueMessageEditor|<Textarea/u)
  assert.doesNotMatch(source, /const \[draft, setDraft\]/u)
})
