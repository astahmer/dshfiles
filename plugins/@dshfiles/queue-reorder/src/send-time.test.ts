import { describe, expect, it } from 'vitest'
import { SendTime } from './send-time.js'

// A Wednesday afternoon in the test runner's own zone: every label and preset is local time.
const wednesday = new Date(2026, 10, 11, 14, 5, 0, 0)

describe('SendTime', () => {
  it('offers relative presets, tomorrow morning and next Monday morning', () => {
    const presets = SendTime.presets(wednesday)
    expect(presets.map(preset => preset.label)).toEqual(['In 30 minutes', 'In 1 hour', 'In 3 hours', 'Tomorrow at 09:00', 'Monday at 09:00'])
    expect(presets[0]?.at).toBe(wednesday.getTime() + 30 * 60_000)
    expect(new Date(presets[3]?.at ?? 0)).toEqual(new Date(2026, 10, 12, 9, 0, 0, 0))
    expect(new Date(presets[4]?.at ?? 0)).toEqual(new Date(2026, 10, 16, 9, 0, 0, 0))
  })

  it('drops the Monday preset on a Sunday, where it would repeat tomorrow morning', () => {
    const sunday = new Date(2026, 10, 15, 20, 0, 0, 0)
    expect(SendTime.presets(sunday).map(preset => preset.label)).toEqual(['In 30 minutes', 'In 1 hour', 'In 3 hours', 'Tomorrow at 09:00'])
  })

  it('labels a send by day and clock, and round-trips the custom field', () => {
    expect(SendTime.label(new Date(2026, 10, 11, 18, 30).getTime(), wednesday)).toBe('Today 18:30')
    expect(SendTime.label(new Date(2026, 10, 12, 9, 0).getTime(), wednesday)).toBe('Tomorrow 09:00')
    expect(SendTime.label(new Date(2026, 10, 20, 7, 45).getTime(), wednesday)).toMatch(/07:45$/u)
    const at = new Date(2026, 10, 12, 9, 15).getTime()
    expect(SendTime.toLocalInput(at)).toBe('2026-11-12T09:15')
    expect(SendTime.fromLocalInput('2026-11-12T09:15')).toBe(at)
    expect(SendTime.fromLocalInput('2026-11-12')).toBeUndefined()
  })
})
