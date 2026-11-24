import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

/** The kit's default (`@dshfiles/plugin-ui` tooltip.tsx): passing the pointer over a toolbar does not flash labels. */
const KIT_DELAY_MS = 400

describe('thread-sidebar tooltips', () => {
  it('never open faster than the kit default', () => {
    const faster = readdirSync(import.meta.dirname)
      .filter(name => name.endsWith('.tsx') && !name.includes('.test.'))
      .flatMap(name =>
        [...readFileSync(join(import.meta.dirname, name), 'utf8').matchAll(/delayDuration=\{(\d+)\}/gu)]
          .filter(match => Number(match[1]) < KIT_DELAY_MS)
          .map(match => `${name}: ${match[0]}`),
      )
    expect(faster).toEqual([])
  })
})
