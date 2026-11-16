import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/TurnProcessNodeView.module.css', import.meta.url), 'utf8')

describe('the "Worked for" row on a touch screen', () => {
  it('is a 44px target on a coarse pointer, and only while it opens something', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(coarse).toMatch(/\.root:not\(:disabled\) \{\s*min-height: 44px;/)
  })
})
