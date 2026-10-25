import { describe, expect, it } from 'vitest'
import { cleanupPreviewLoadingLabel } from './workspace-cleanup-preview.js'

describe('cleanupPreviewLoadingLabel', () => {
  it('distinguishes the first load from a refresh that keeps the previous preview visible', () => {
    expect(cleanupPreviewLoadingLabel({ isFetching: true, hasData: false })).toBe('Loading preview…')
    expect(cleanupPreviewLoadingLabel({ isFetching: true, hasData: true })).toBe('Updating preview…')
  })

  it('returns no loading label after fetching finishes', () => {
    expect(cleanupPreviewLoadingLabel({ isFetching: false, hasData: true })).toBeUndefined()
  })
})
