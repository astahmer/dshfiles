import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('./native/skeleton/InputBar.module.css', import.meta.url), 'utf8')

/** The declarations of every rule whose selector list contains `needle`. */
const rulesWith = (needle: string): string[] =>
  [...css.matchAll(/([^{}]+)\{([^}]*)\}/gu)].filter(match => (match[1] ?? '').includes(needle)).map(match => `${match[1] ?? ''}{${match[2] ?? ''}}`)

describe('phone composer keeps the model name (council picker round 1, N8)', () => {
  it('truncates the name to 4 rem on a tight bar instead of dropping it', () => {
    const tight = rulesWith('.row[data-model-mark-tight]')
    expect(tight.some(rule => /\[data-model-picker-text\][^{]*\{[^}]*display:\s*none/u.test(rule))).toBe(false)
    expect(tight.some(rule => /\[data-model-picker-text\][^{]*\{[^}]*max-width:\s*4rem/u.test(rule))).toBe(true)
  })

  it('keeps the account tag on the phone bar, so a swap shows', () => {
    const hiddenOnPhone = rulesWith('.row[data-model-mark]').filter(rule => /\{[^}]*display:\s*none/u.test(rule))
    expect(hiddenOnPhone.length).toBeGreaterThan(0)
    expect(hiddenOnPhone.some(rule => rule.includes('[data-model-picker-provider]'))).toBe(false)
  })
})
