import { describe, expect, it } from 'vitest'
import { headerNamesPreset } from '../src/native/label-visibility.ts'

describe('thread header preset label (b:4qjm)', () => {
  it('names a non-default preset and leaves the default unnamed', () => {
    expect(headerNamesPreset('standard', 'ready', 'standard')).toBe(false)
    expect(headerNamesPreset('cordis', 'ready', 'standard')).toBe(true)
  })
  it('draws nothing until the roster is known, and the recorded preset when it cannot be read', () => {
    expect(headerNamesPreset('cordis', 'loading', '')).toBe(false)
    expect(headerNamesPreset('standard', 'error', '')).toBe(true)
    expect(headerNamesPreset(undefined, 'ready', 'standard')).toBe(false)
  })
})
