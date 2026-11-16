import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { REQUEST_STATUS_GLYPH } from './request-status.js'

describe('request status', () => {
  it('maps onto the shared status vocabulary: only a failure is coloured', () => {
    expect(REQUEST_STATUS_GLYPH).toEqual({ ok: 'done', aborted: 'stopped', failed: 'failed', unknown: 'stale' })
  })
  it('keeps no private colour table and no indigo meter', () => {
    for (const file of ['request-log.tsx', 'account-usage-dashboard.tsx']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source, file).not.toMatch(/dshx:bg-(success|warning|info)\b/u)
    }
  })
})
