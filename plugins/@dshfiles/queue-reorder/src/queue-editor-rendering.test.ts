import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('editing a queued message keeps draft state out of the list component', async () => {
  const source = await readFile(new URL('./client.tsx', import.meta.url), 'utf8')
  const editorStart = source.indexOf('const QueueMessageEditor =')
  const dockStart = source.indexOf('export const DraggableQueueDock =')

  assert.ok(editorStart >= 0)
  assert.ok(dockStart > editorStart)
  const editorSource = source.slice(editorStart, dockStart)
  const dockSource = source.slice(dockStart)
  assert.match(editorSource, /const \[draft, setDraft\] = useState\(props\.text\)/u)
  assert.match(editorSource, /onChange=\{event => setDraft\(event\.target\.value\)\}/u)
  assert.match(dockSource, /<QueueMessageEditor/u)
  assert.doesNotMatch(dockSource, /const \[draft, setDraft\]/u)
})
