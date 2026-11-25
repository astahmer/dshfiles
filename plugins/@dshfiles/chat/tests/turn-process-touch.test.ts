import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../src/native/chat/TurnProcessNodeView.module.css', import.meta.url), 'utf8')

describe('the "Worked for" row on a touch screen', () => {
  // Round five C2 (council round 4): a 44px row put 20px of air between "Worked for" and the "New" divider on a phone;
  // the row draws at 24px and its tap area reaches 10px past each edge.
  it('answers a 44px tap on a coarse pointer, and only while it opens something', () => {
    const coarse = /@media \(pointer: coarse\) \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? ''
    expect(coarse).toMatch(/\.root:not\(:disabled\)::after \{[^}]*inset: -10px 0;/)
  })
})
