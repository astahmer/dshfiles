import { describe, expect, it } from 'vitest'
import { type ProjectBookmarkView, projectMainBranch } from './api.js'

const resolved = (input: Pick<ProjectBookmarkView, 'bookmark' | 'source'>): ProjectBookmarkView => ({
  repositoryRoot: '/repo',
  bookmark: input.bookmark,
  source: input.source,
  override: null,
  declared: null,
  detected: null,
  fallback: 'main',
  bookmarks: [],
})

describe('projectMainBranch', () => {
  it('answers the bookmark only when a trusted layer chose it', () => {
    expect(projectMainBranch({ resolved: resolved({ bookmark: 'develop', source: 'file' }), sources: ['project', 'file'] })).toBe('develop')
    expect(projectMainBranch({ resolved: resolved({ bookmark: 'develop', source: 'detected' }), sources: ['project', 'file'] })).toBeUndefined()
    expect(projectMainBranch({ resolved: resolved({ bookmark: 'develop', source: 'detected' }), sources: ['project', 'file', 'detected'] })).toBe('develop')
  })

  it('refuses a name that is not a plain branch', () => {
    expect(projectMainBranch({ resolved: resolved({ bookmark: 'main|@', source: 'project' }), sources: ['project'] })).toBeUndefined()
    expect(projectMainBranch({ resolved: resolved({ bookmark: '--output=x', source: 'project' }), sources: ['project'] })).toBeUndefined()
  })
})
