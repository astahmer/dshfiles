import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { en } from '../src/native/locale.ts'

const css = readFileSync(new URL('../src/native/chat/TurnTriggerNodeView.module.css', import.meta.url), 'utf8')

/** The declarations of one top-level rule. */
const rule = (selector: string): string => {
  const match = new RegExp(`(?:^|\\n)${selector.replace('.', '\\.')} \\{([^}]*)\\}`).exec(css)
  if (match?.[1] === undefined) throw new Error(`no ${selector} rule`)
  return match[1]
}

describe('the turn trigger row', () => {
  it('is a muted line, not a bordered card with the weight of a user message', () => {
    expect(rule('.root')).not.toMatch(/border|background/)
    expect(rule('.header')).toMatch(/padding: 2px 0;/)
    expect(rule('.header')).toMatch(/--dsh-content-font-size-secondary/)
  })

  it('says who wrote, in plain words', () => {
    expect(en['message.trigger.agent']).toBe('Message from another agent')
    expect(en['message.trigger.agent']).not.toMatch(/Task message/)
  })
})
