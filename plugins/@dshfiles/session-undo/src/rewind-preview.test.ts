import { describe, expect, it } from 'vitest'
import { elapsedLabel, rewindPreview } from './rewind-preview.js'

const labels = { untitled: '(no text)', files: 'files' }

describe('rewindPreview', () => {
  const checkpoints = [
    { turn: 1, prompt: 'first', at: 1_000_000, files: true },
    { turn: 2, prompt: '', at: 1_065_000, files: false },
    { turn: 3, prompt: 'third', at: 1_000_000 + 3_725_000, files: true },
  ]

  it('marks the rewound slice abandoned on one lane, timed from the first checkpoint', () => {
    expect(rewindPreview(checkpoints, 1, labels)).toEqual([
      { id: '1-1000000', label: 'first', lane: 0, abandoned: false, time: '0:00', note: 'files' },
      { id: '2-1065000', label: '(no text)', lane: 0, abandoned: true, time: '1:05' },
      { id: '3-4725000', label: 'third', lane: 0, abandoned: true, time: '1h02', note: 'files' },
    ])
  })

  it('leaves files undefined and abandons nothing without a rewound slice', () => {
    const preview = rewindPreview(checkpoints, -1, labels)
    expect(preview.every(checkpoint => checkpoint.abandoned === false && checkpoint.files === undefined)).toBe(true)
  })

  it('returns no rows for an empty history', () => {
    expect(rewindPreview([], 0, labels)).toEqual([])
  })
})

describe('elapsedLabel', () => {
  it('clamps negative gaps to zero', () => {
    expect(elapsedLabel(-5000)).toBe('0:00')
  })
})
