import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/** Every rule whose selector holds `:hover` and that no `@media (hover: hover)` encloses, as `line: selector`. */
export const ungatedHoverRules = (css: string): readonly string[] => {
  const text = css.replaceAll(/\/\*[\s\S]*?\*\//g, comment => comment.replaceAll(/[^\n]/g, ' '))
  const stack: string[] = []
  const found: string[] = []
  let prelude = ''
  let start = 0
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]
    if (char === '{') {
      const selector = prelude.trim()
      if (selector.includes(':hover') && !stack.some(outer => /@media[^{]*\(hover:\s*hover\)/u.test(outer)))
        found.push(`${text.slice(0, start).split('\n').length}: ${selector.replaceAll(/\s+/g, ' ')}`)
      stack.push(selector)
      prelude = ''
    } else if (char === '}') {
      stack.pop()
      prelude = ''
    } else if (char === ';') {
      prelude = ''
    } else {
      if (prelude.trim() === '') start = index
      prelude += char
    }
  }
  return found
}

const sheet = (path: string): string => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')

describe('hover styles sit behind (hover: hover) (DESIGN.md R12)', () => {
  it.each(['./native/QuestionComposer.module.css', './native/QuestionReplyView.module.css', './native/PlanReviewPanel.module.css'])(
    '%s has no hover rule a tap can stick',
    path => {
      expect(ungatedHoverRules(sheet(path))).toEqual([])
    },
  )
})
