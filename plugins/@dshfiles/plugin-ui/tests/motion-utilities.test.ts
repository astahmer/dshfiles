import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = (): string => readFileSync(join(process.cwd(), 'src/motion-utilities.css'), 'utf8')

/** The declarations of the first rule whose selector list is exactly `selector`, outside any at-rule wrapper. */
const rule = (source: string, selector: string): string => {
  const start = source.indexOf(`${selector} {`)
  expect(start, selector).toBeGreaterThanOrEqual(0)
  return source.slice(start, source.indexOf('}', start))
}

const reducedBlock = (source: string): string => {
  const start = source.indexOf('@media (prefers-reduced-motion: reduce)')
  expect(start).toBeGreaterThanOrEqual(0)
  return source.slice(start)
}

describe('motion utilities', () => {
  it('reveals with grid-template-rows, 120ms in and 100ms out', () => {
    const source = css()
    const reveal = rule(source, '.dshx-reveal')
    expect(reveal).toContain('grid-template-rows: 1fr;')
    expect(reveal).toContain('var(--dshx-duration-fade)')
    expect(rule(source, ".dshx-reveal[data-state='closed']")).toContain('grid-template-rows: 0fr;')
    expect(rule(source, ".dshx-reveal[data-state='closed']")).toContain('var(--dshx-duration-exit)')
    expect(source).toMatch(/@starting-style\s*\{\s*\.dshx-reveal\s*\{\s*grid-template-rows: 0fr;/)
  })

  it('pops in with opacity and 4px of travel in 120ms, out in 100ms', () => {
    const source = css()
    const pop = rule(source, '.dshx-pop-in')
    expect(pop).toContain('var(--dshx-duration-fade)')
    expect(source).toContain('--dshx-pop-in-travel: -4px;')
    expect(rule(source, ".dshx-pop-in[data-state='closed']")).toContain('var(--dshx-duration-exit)')
  })

  it('is an opacity change only under reduced motion', () => {
    const reduced = reducedBlock(css())
    expect(reduced).toContain('.dshx-reveal')
    expect(reduced).toContain('transition-property: opacity, visibility;')
    expect(reduced).toContain('.dshx-pop-in')
    expect(reduced).toContain('translate: none;')
  })

  it('is imported by the kit stylesheet with one line', () => {
    const styles = readFileSync(join(process.cwd(), 'src/styles.css'), 'utf8')
    expect(styles.match(/@import '\.\/motion-utilities\.css';/g)).toHaveLength(1)
  })
})
