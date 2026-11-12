import { describe, expect, it } from 'vitest'
import { deviceDefaultTranscriptView, OFFERED_TRANSCRIPT_VIEW_MODES, savedTranscriptView, TRANSCRIPT_VIEW_MODE_NAMES } from '../src/transcript-view-modes.ts'

describe('transcript view modes', () => {
  it('offers Summary, Normal and Verbose', () => {
    expect(OFFERED_TRANSCRIPT_VIEW_MODES.map(mode => TRANSCRIPT_VIEW_MODE_NAMES[mode])).toEqual(['Summary', 'Normal', 'Verbose'])
  })

  it('defaults to Summary on a touch phone, Normal in other browsers and Standard in the desktop app', () => {
    expect(deviceDefaultTranscriptView({ desktopApp: false, coarsePointer: true })).toBe('compact')
    expect(deviceDefaultTranscriptView({ desktopApp: false, coarsePointer: false })).toBe('detailed')
    expect(deviceDefaultTranscriptView({ desktopApp: true, coarsePointer: true })).toBe('standard')
  })

  it('reads saved values, legacy ones as Normal, and ignores anything else', () => {
    expect(savedTranscriptView('verbose')).toBe('verbose')
    expect(savedTranscriptView('normal')).toBe('detailed')
    expect(savedTranscriptView('expanded')).toBe('detailed')
    expect(savedTranscriptView('loud')).toBeUndefined()
    expect(savedTranscriptView(null)).toBeUndefined()
  })
})
