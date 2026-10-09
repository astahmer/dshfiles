import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'vitest'

test('queue dock follows the host composer card width instead of the whole column', async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL('./client.tsx', import.meta.url), 'utf8'),
    readFile(new URL('./client.css', import.meta.url), 'utf8'),
  ])
  const dockRule = styles.match(/\[data-queue-dock\]\s*\{([^}]+)\}/u)?.[1]

  assert.match(component, /data-queue-dock/u)
  assert.ok(dockRule)
  assert.match(dockRule, /width:\s*calc\(100%\s*-\s*var\(--dsh-composer-side-clearance\)/u)
  assert.match(dockRule, /max-width:\s*calc\(var\(--dsh-composer-card-max-width\)/u)
  assert.match(dockRule, /margin:\s*0\s+auto/u)
})
