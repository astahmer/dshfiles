import { describe, expect, it } from 'vitest'
import { checkTones, issueStateTones, pullStateTones } from './linked-state-tones.js'

describe('linked pull request and issue rows', () => {
  it('draw merged, closed and open in neutral ink; only failing checks are red', () => {
    for (const tone of [...Object.values(pullStateTones), ...Object.values(issueStateTones)]) expect(tone).toBe('dshx:text-muted-foreground')
    expect(checkTones.failing).toBe('dshx:text-destructive')
    for (const [state, tone] of Object.entries(checkTones)) if (state !== 'failing') expect(tone).toBe('dshx:text-muted-foreground')
    expect(JSON.stringify([pullStateTones, issueStateTones, checkTones])).not.toMatch(/success|violet|warning/u)
  })
})
