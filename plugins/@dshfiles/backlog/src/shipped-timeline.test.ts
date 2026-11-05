import { describe, expect, it } from 'vitest'
import { ShippedTimeline } from './shipped-timeline.js'

const local = (month: number, day: number, hour = 0): number => new Date(2026, month, day, hour).getTime()
const NOW = local(10, 4, 15)

describe('shipped timeline', () => {
  it('keeps the current period and every busy one, folding runs of empty periods into one quiet line', () => {
    const buckets = [
      { start: 5, end: 6, count: 0 },
      { start: 4, end: 5, count: 2 },
      { start: 3, end: 4, count: 0 },
      { start: 2, end: 3, count: 0 },
      { start: 1, end: 2, count: 1 },
      { start: 0, end: 1, count: 0 },
    ]
    expect(
      ShippedTimeline.entriesOf(buckets).map(entry =>
        entry.kind === 'bucket' ? [entry.bucket.start, entry.current] : ['quiet', entry.start, entry.end, entry.periods],
      ),
    ).toEqual([
      [5, true],
      [4, false],
      ['quiet', 2, 4, 2],
      [1, false],
      ['quiet', 0, 1, 1],
    ])
    expect(ShippedTimeline.quietLabel('day', 2)).toBe('2 quiet days')
    expect(ShippedTimeline.quietLabel('week', 1)).toBe('1 quiet week')
  })

  it('names buckets relative to now', () => {
    const label = (unit: 'hour' | 'day' | 'week' | 'month' | 'year', start: number) => ShippedTimeline.labelOf({ unit, start, now: NOW, locale: 'en-US' })
    expect(label('day', local(10, 4))).toBe('Today')
    expect(label('day', local(10, 3))).toBe('Yesterday')
    expect(label('day', local(10, 1))).toBe('Sun, Nov 1')
    expect(label('day', new Date(2025, 11, 30).getTime())).toBe('Tue, Dec 30, 2025')
    expect(label('week', local(10, 2))).toBe('This week')
    expect(label('week', local(9, 26))).toBe('Last week')
    expect(label('week', local(9, 19))).toBe('Week of Oct 19')
    expect(label('month', local(10, 1))).toBe('This month')
    expect(label('month', local(9, 1))).toBe('October 2026')
    expect(label('year', local(0, 1))).toBe('This year')
    expect(label('year', new Date(2024, 0, 1).getTime())).toBe('2024')
    expect(label('hour', local(10, 4, 14))).toBe('2:00 PM')
    expect(label('hour', local(10, 3, 23))).toBe('Tue, Nov 3, 11:00 PM')
  })

  it('reads the delta against the previous period', () => {
    expect(ShippedTimeline.deltaOf({ count: 5, previousCount: 2 })).toEqual({ text: '+3', tone: 'up' })
    expect(ShippedTimeline.deltaOf({ count: 1, previousCount: 3 })).toEqual({ text: '−2', tone: 'down' })
    expect(ShippedTimeline.deltaOf({ count: 0, previousCount: 0 })).toEqual({ text: '±0', tone: 'flat' })
  })
})
