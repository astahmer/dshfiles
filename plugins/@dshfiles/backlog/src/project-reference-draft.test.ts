import { describe, expect, it } from 'vitest'

import { projectReferenceDraftToken, serializeProjectReferenceDraft } from './project-reference-draft.js'

describe('backlog project-reference drafts', () => {
  it('keeps the selected project readable while drafting and serializes on submit', () => {
    const path = '/Users/me/dev/bb-plugins'
    const projects = [path]
    const token = projectReferenceDraftToken(path, projects)

    expect(token).toBe('@project:bb-plugins')
    expect(serializeProjectReferenceDraft(`See ${token}`, projects)).toBe('See [bb-plugins](workspace:%2FUsers%2Fme%2Fdev%2Fbb-plugins)')
  })

  it('disambiguates projects that share a folder name', () => {
    const firstPath = '/work/alpha/shared'
    const secondPath = '/work/beta/shared'
    const projects = [firstPath, secondPath]
    const first = projectReferenceDraftToken(firstPath, projects)
    const second = projectReferenceDraftToken(secondPath, projects)

    expect(first).toBe('@project:alpha-shared')
    expect(second).toBe('@project:beta-shared')
    expect(serializeProjectReferenceDraft(`${first} ${second}`, projects)).toBe(
      '[shared](workspace:%2Fwork%2Falpha%2Fshared) [shared](workspace:%2Fwork%2Fbeta%2Fshared)',
    )
  })

  it('leaves unknown project tokens untouched', () => {
    expect(serializeProjectReferenceDraft('See @project:missing', ['/work/known'])).toBe('See @project:missing')
  })
})
