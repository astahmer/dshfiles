import { describe, expect, it } from 'vitest'
import { sessionCostDialogMatches, type SessionCostDialogRow } from './session-cost-display.js'

const rows: readonly SessionCostDialogRow[] = [
  { tokens: undefined, amount: undefined },
  { tokens: 60_609, amount: '$0.0061' },
  { tokens: 358_312, amount: '$0.0036' },
  { tokens: 5_929, amount: '$0.0030' },
]

describe('sessionCostDialogMatches', () => {
  it('confirms the native token rows by position and keeps their existing values', () => {
    expect(sessionCostDialogMatches(['86%', '60,609 tok', '358,312 tok', '5,929 tok'], rows)).toBe(true)
  })

  it('declines mismatched or duplicate rows instead of decorating the wrong cells', () => {
    expect(sessionCostDialogMatches(['86%', '60,609 tok', '358,312 tok', '5,929 tok', 'Last turn'], rows)).toBe(false)
    expect(sessionCostDialogMatches(['86%', '60,609 tok', '358,312 tok', '6,000 tok'], rows)).toBe(false)
    expect(sessionCostDialogMatches(['60,609 tok', '358,312 tok', '5,929 tok', '6,000 tok'], rows)).toBe(false)
  })
})
