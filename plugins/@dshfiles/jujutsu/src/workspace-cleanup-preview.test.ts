import { describe, expect, it } from 'vitest'
import { cleanupPreviewLoadingLabel, cleanupProcessLabels } from './workspace-cleanup-preview.js'

describe('cleanupPreviewLoadingLabel', () => {
  it('distinguishes the first load from a refresh that keeps the previous preview visible', () => {
    expect(cleanupPreviewLoadingLabel({ isFetching: true, hasData: false })).toBe('Loading preview…')
    expect(cleanupPreviewLoadingLabel({ isFetching: true, hasData: true })).toBe('Updating preview…')
  })

  it('returns no loading label after fetching finishes', () => {
    expect(cleanupPreviewLoadingLabel({ isFetching: false, hasData: true })).toBeUndefined()
  })
})

describe('cleanupProcessLabels', () => {
  it('names the processes a removal stops and the terminals it keeps', () => {
    expect(
      cleanupProcessLabels([
        { pid: 10, command: 'vite', outcome: 'would-stop' },
        { pid: 11, command: 'node', outcome: 'would-stop' },
        { pid: 12, command: '-zsh', outcome: 'kept-terminal' },
      ]),
    ).toEqual(['Stops vite, node', 'Keeps terminal -zsh'])
  })

  it('adds nothing when no process runs there, or the Host predates the list', () => {
    expect(cleanupProcessLabels([])).toEqual([])
    expect(cleanupProcessLabels(undefined)).toEqual([])
  })
})
