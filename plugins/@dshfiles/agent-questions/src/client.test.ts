import { describe, expect, it } from 'vitest'
import { questionCardSheet } from './client.js'

describe('question card sheet', () => {
  const narrow = questionCardSheet.slice(questionCardSheet.indexOf('@container dshfiles-question-card'))

  it('stacks the narrow header only while it holds the countdown button, so the controls do not float on a row of their own', () => {
    const headerRules = narrow.split('\n').filter(line => line.includes('>section>header') && !line.includes('span:has('))
    expect(headerRules.length).toBeGreaterThan(0)
    for (const rule of headerRules) expect(rule).toContain('header:has([class*="_waitButton"])')
  })
})
