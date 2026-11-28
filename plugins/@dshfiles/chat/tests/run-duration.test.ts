import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { formatRunDuration } from '../src/native/chat/message-chrome.ts'

const text = (ms: number): string => formatRunDuration(ms).map(part => part.text).join('')

describe('transcript durations on the kit grammar (DESIGN.md › Durations, round three C9)', () => {
  it('says "Worked for", "Working for" and "Thought for" as the kit does: padded, no translated units', () => {
    expect(text(9_400)).toBe('9s')
    expect(text(125_000)).toBe('2m 05s')
    expect(text(3_840_000)).toBe('1h 04m')
    expect(text(-5)).toBe('0s')
  })

  it('keeps the numbers apart from their units, so only the digits take the tabular face', () => {
    expect(formatRunDuration(125_000)).toEqual([
      { text: '2', numeric: true },
      { text: 'm ', numeric: false },
      { text: '05', numeric: true },
      { text: 's', numeric: false },
    ])
  })

  it('shows the composer statistics as measured spans with the kit, not a local formatter', () => {
    const pills = readFileSync(new URL('../src/native/chat/StatsPills.tsx', import.meta.url), 'utf8')
    expect(pills).toContain("import { formatDurationMs } from '@dshfiles/plugin-ui/lib/format-duration'")
    expect(pills).not.toMatch(/function formatDuration\b/)
  })
})
