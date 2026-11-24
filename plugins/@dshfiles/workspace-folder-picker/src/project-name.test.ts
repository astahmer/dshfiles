import { describe, expect, it } from 'vitest'
import { ProjectName, type ProjectNameEntry } from './project-name.js'

describe('project display names', () => {
  it('uses the saved label, ignoring trailing separators on either side', () => {
    const entries: ProjectNameEntry[] = [{ project: '/Users/me/some-really-long-folder-name', name: 'NixConfig' }]
    expect(ProjectName.displayNameOf('/Users/me/some-really-long-folder-name/', entries)).toBe('NixConfig')
    expect(ProjectName.displayNameOf('/Users/me/other', entries)).toBeUndefined()
  })

  it('treats a blank label as no label, so the folder name applies again', () => {
    expect(ProjectName.displayNameOf('/Users/me/app', [{ project: '/Users/me/app', name: '   ' }])).toBeUndefined()
    expect(ProjectName.upsert([{ project: '/Users/me/app', name: 'App' }], '/Users/me/app', '')).toEqual([])
  })

  it('keeps one entry per project and trims the label', () => {
    const once = ProjectName.upsert([], '/Users/me/app', '  My app ')
    expect(once).toEqual([{ project: '/Users/me/app', name: 'My app' }])
    const twice = ProjectName.upsert(once, '/Users/me/app/', 'Other')
    expect(twice).toEqual([{ project: '/Users/me/app', name: 'Other' }])
  })
})
