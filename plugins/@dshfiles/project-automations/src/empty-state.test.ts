import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('automations with nothing saved', () => {
  it('uses the one empty state: a framed sentence, no bold title over two lines', () => {
    const panel = readFileSync(new URL('automations-panel.tsx', import.meta.url), 'utf8')
    expect(panel).toContain('<EmptyState')
    expect(panel).not.toMatch(/<EmptyTitle|<EmptyHeader|<EmptyDescription/u)
  })
})
