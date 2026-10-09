import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('queue dock follows the host composer card width instead of the whole column', async () => {
  const component = await readFile(new URL('./client.tsx', import.meta.url), 'utf8')
  const dockStyle = component.match(/const QUEUE_DOCK_STYLE: CSSProperties = \{([^}]+)\}/u)?.[1]

  assert.match(component, /data-queue-dock="" style=\{QUEUE_DOCK_STYLE\}/u)
  assert.ok(dockStyle)
  assert.match(dockStyle, /width: 'calc\(100%\s*-\s*var\(--dsh-composer-side-clearance\)/u)
  assert.match(dockStyle, /maxWidth: 'calc\(var\(--dsh-composer-card-max-width\)/u)
  assert.match(dockStyle, /margin: '0 auto/u)
})
