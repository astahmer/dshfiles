import { readFileSync } from 'node:fs'
import { expect, test } from 'vitest'

const lineageCss = readFileSync(new URL('./SubagentHeaderLineage.module.css', import.meta.url), 'utf8')
const headerCss = readFileSync(new URL('../../../rich-composer/src/native/skeleton/ConversationRoot.module.css', import.meta.url), 'utf8')

/**
 * The declarations a lone class gets from top-level rules, in source order: every block whose selector list names
 * `.name` on its own (`.a, .name {`), the later block winning. Nested and compound selectors are left out.
 */
const declarationsOf = (css: string, name: string): ReadonlyMap<string, string> => {
  const result = new Map<string, string>()
  const source = css.replaceAll(/\/\*[\s\S]*?\*\//g, '')
  const blocks: { readonly selector: string; readonly body: string }[] = []
  let depth = 0
  let start = 0
  let selector = ''
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') {
      if (depth === 0) {
        selector = source.slice(start, index).trim()
        start = index + 1
      }
      depth += 1
    } else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        blocks.push({ selector, body: source.slice(start, index) })
        start = index + 1
      }
    }
  }
  for (const block of blocks) {
    if (block.body.includes('{')) continue
    const selectors = block.selector.split(',').map(part => part.trim())
    if (!selectors.includes(`.${name}`)) continue
    for (const declaration of block.body.split(';')) {
      const [property, ...value] = declaration.split(':')
      if (property !== undefined && value.length > 0) result.set(property.trim(), value.join(':').trim())
    }
  }
  return result
}

test('the parent crumb, the "/" and the child crumb share one size; the child alone is 600 ink (council round 23, item 8)', () => {
  const parent = declarationsOf(headerCss, 'crumb')
  const separator = declarationsOf(headerCss, 'crumbSep')
  const child = declarationsOf(lineageCss, 'switcherTrigger')
  const ancestor = declarationsOf(lineageCss, 'ancestorSwitcherTrigger')
  expect(parent.get('font-size')).toBe('14px')
  expect(separator.get('font-size')).toBe('14px')
  expect(child.get('font-size')).toBe('14px')
  expect(child.get('line-height')).toBe(parent.get('line-height'))
  // Parent 400 muted (the crumb sets no weight), the child 600 in the primary ink.
  expect(parent.get('font-weight')).toBeUndefined()
  expect(parent.get('color')).toBe('var(--dsw-alias-label-tertiary)')
  expect(child.get('font-weight')).toBe('600')
  expect(child.get('color')).toBe('var(--dsw-alias-label-primary)')
  // A grandchild's ancestor crumb reads as a parent crumb: 400, muted.
  expect(ancestor.get('font-weight')).toBe('400')
  expect(ancestor.get('color')).toBe('var(--dsw-alias-label-tertiary)')
  // The count chip keeps its 12px.
  expect(declarationsOf(lineageCss, 'trigger').get('font-size')).toBe('12px')
})
