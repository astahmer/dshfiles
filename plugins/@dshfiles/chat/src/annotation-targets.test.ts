import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * Upstream's annotation marker (the numbered tab beside an annotated passage) is an 18px box: a pointer had to land
 * on 18px, a thumb on less than half its target. Its hit area grows to 24px, 44px on a coarse pointer, while the tab
 * keeps its drawn size. The quick-comment box's save button is the one primary there, so it takes the kit's primary
 * fill instead of the raw ink.
 */
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//gu, '')
const marks = read('./native/chat/annotation-marks.module.css')
const selection = read('./native/chat/AnnotateSelection.module.css')

/** The declarations of the rule whose selector is exactly `selector` inside `scope`. */
const declarations = (scope: string, selector: string): Readonly<Record<string, string>> => {
  const rule = [...scope.matchAll(/([^{}]+)\{([^{}]*)\}/gu)].find(([, selectors]) => selectors?.trim() === selector)
  return Object.fromEntries(
    (rule?.[2] ?? '')
      .split(';')
      .map(line => line.split(/:(.*)/su).map(part => part.trim()))
      .filter((pair): pair is [string, string] => pair.length >= 2 && pair[0] !== '')
      .map(([property, value]) => [property, value]),
  )
}

const mediaBlock = (css: string, query: string): string => {
  const start = css.indexOf(`@media ${query} {`)
  if (start === -1) return ''
  let depth = 0
  for (let index = css.indexOf('{', start); index < css.length; index += 1) {
    if (css[index] === '{') depth += 1
    if (css[index] === '}') depth -= 1
    if (depth === 0) return css.slice(start, index + 1)
  }
  return ''
}

/** The side of a square hit area a pseudo-element with `inset` adds around an 18px tab. */
const hitSide = (inset: string | undefined): number => {
  const match = /^-(\d+)px$/u.exec(inset ?? '')
  return match === null ? 18 : 18 + 2 * Number(match[1])
}

describe('annotation marker and quick comment', () => {
  it('keeps the marker drawn at 18px', () => {
    expect(declarations(marks, '.marker')).toMatchObject({ width: '18px', height: '18px' })
  })

  it('gives the marker a 24px hit area, 44px on a coarse pointer', () => {
    const area = declarations(marks, '.marker::before')
    expect(area.content).toBe("''")
    expect(area.position).toBe('absolute')
    expect(hitSide(area.inset)).toBe(24)
    expect(hitSide(declarations(mediaBlock(marks, '(pointer: coarse)'), '.marker::before').inset)).toBe(44)
  })

  it("fills the save button with the kit's primary tone", () => {
    const save = declarations(selection, '.commentSave')
    expect(save.background).toBe('var(--dsw-alias-brand-primary)')
    expect(save.color).toBe('var(--dsw-alias-label-primary-foreground)')
    expect(declarations(selection, '.commentSave:hover').background).toBe('var(--dshx-primary-hover)')
  })
})
