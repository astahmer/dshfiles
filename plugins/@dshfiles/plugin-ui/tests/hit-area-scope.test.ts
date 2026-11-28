import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

// Vitest runs each package from its root.
const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')

/**
 * Council round 27, item 12: the kit's 44px hit area (a `::after` or `::before` that reaches past a small control) is a
 * touch affordance. On a mouse it would take a click meant for the neighbouring row, so every such rule sits inside a
 * coarse-pointer media query.
 */
describe('the 44px hit-area extension', () => {
  it('exists only under a coarse pointer', () => {
    const extensions = [...styles.matchAll(/inset:\s*min\(0px,\s*calc\(\(100% - 44px\) \/ 2\)\)/gu)]
    expect(extensions.length).toBeGreaterThan(0)
    for (const extension of extensions) {
      const before = styles.slice(0, extension.index)
      // The innermost enclosing @media block is the last one opened before the rule and not yet closed.
      let depth = 0
      let media = ''
      for (let at = before.length - 1; at >= 0; at -= 1) {
        const char = before[at]
        if (char === '}') depth += 1
        else if (char === '{') {
          if (depth === 0) {
            const head = before.slice(before.lastIndexOf('\n', at - 1) + 1, at)
            if (head.trimStart().startsWith('@media')) {
              media = head
              break
            }
          } else depth -= 1
        }
      }
      expect(media).toMatch(/\(pointer:\s*coarse\)/u)
    }
  })
})
