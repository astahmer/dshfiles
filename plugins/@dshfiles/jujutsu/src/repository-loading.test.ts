import { describe, expect, it } from 'vitest'
import { repositoryLoadingState, shouldReregisterRepository } from './repository-loading.js'

describe('repositoryLoadingState', () => {
  it('shows the toolbar indicator during background refetches without replacing loaded content', () => {
    expect(repositoryLoadingState({ registering: false, fetching: true, hasState: true, hasError: false })).toEqual({
      loading: true,
      showEmptyPrompt: false,
      showLoadFailure: false,
    })
  })

  it('keeps the empty prompt hidden while the initial repository load is pending', () => {
    expect(repositoryLoadingState({ registering: false, fetching: true, hasState: false, hasError: false })).toEqual({
      loading: true,
      showEmptyPrompt: false,
      showLoadFailure: false,
    })
  })

  it('shows the repository picker prompt when no load is active and no state exists', () => {
    expect(repositoryLoadingState({ registering: false, fetching: false, hasState: false, hasError: false })).toEqual({
      loading: false,
      showEmptyPrompt: true,
      showLoadFailure: false,
    })
  })

  it('keeps loaded graph content after a failed background refresh', () => {
    expect(repositoryLoadingState({ registering: false, fetching: false, hasState: true, hasError: true })).toEqual({
      loading: false,
      showEmptyPrompt: false,
      showLoadFailure: false,
    })
  })

  it('shows a failure state instead of asking for a repository after a failed load', () => {
    expect(repositoryLoadingState({ registering: false, fetching: false, hasState: false, hasError: true })).toEqual({
      loading: false,
      showEmptyPrompt: false,
      showLoadFailure: true,
    })
  })

  it('re-registers a selected repository once after a Host restart invalidates its in-memory id', () => {
    expect(shouldReregisterRepository({ hasError: true, repoId: 'old-host-id', path: '/work/project', recoveredPath: null })).toBe(true)
    expect(shouldReregisterRepository({ hasError: true, repoId: 'new-host-id', path: '/work/project', recoveredPath: '/work/project' })).toBe(false)
    expect(shouldReregisterRepository({ hasError: false, repoId: 'new-host-id', path: '/work/project', recoveredPath: null })).toBe(false)
    expect(shouldReregisterRepository({ hasError: true, repoId: null, path: '/work/project', recoveredPath: null })).toBe(false)
  })
})
