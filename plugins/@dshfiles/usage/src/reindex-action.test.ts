import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { reindexAction } from './reindex-action.js'

describe('Usage › Re-index thread logs (council round 8, D1)', () => {
  const onSelect = (): void => undefined

  it('sits in the page ⋯ while the index is healthy', () => {
    expect(reindexAction({ healthy: true, pending: false, onSelect }).placement).toBe('overflow')
  })

  it('comes back as a header button when indexing failed, so the recovery is one click away', () => {
    expect(reindexAction({ healthy: false, pending: false, onSelect }).placement).toBe('inline')
  })

  it('keeps its label and spinner state', () => {
    const action = reindexAction({ healthy: true, pending: true, onSelect })
    expect(action.label).toBe('Re-index thread logs')
    expect(action.pending).toBe(true)
  })

  it('is the action the page renders, fed by the index health', () => {
    const panel = readFileSync(new URL('panel.tsx', import.meta.url), 'utf8')
    expect(panel).toMatch(/actions=\{\[reindexAction\(\{ healthy: indexError === null && refreshError === null,/u)
  })
})
