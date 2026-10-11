import { describe, expect, it } from 'vitest'
import { repositoryLoadingState } from './repository-loading.js'

describe('repositoryLoadingState', () => {
  it('shows the toolbar indicator during background refetches without replacing loaded content', () => {
    expect(repositoryLoadingState({ registering: false, fetching: true, hasState: true })).toEqual({ loading: true, showEmptyPrompt: false })
  })

  it('keeps the empty prompt hidden while the initial repository load is pending', () => {
    expect(repositoryLoadingState({ registering: false, fetching: true, hasState: false })).toEqual({ loading: true, showEmptyPrompt: false })
  })

  it('shows the repository picker prompt when no load is active and no state exists', () => {
    expect(repositoryLoadingState({ registering: false, fetching: false, hasState: false })).toEqual({ loading: false, showEmptyPrompt: true })
  })
})
