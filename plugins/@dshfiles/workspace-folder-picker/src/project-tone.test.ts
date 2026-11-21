import { describe, expect, it } from 'vitest'
import { defaultProjectTone, projectFolderName, projectToneClass, projectToneOf, PROJECT_TONE_COUNT, upsertProjectTone } from './project-tone.js'

describe('project tones', () => {
  it('gives a project the same automatic tone on every import', () => {
    expect(defaultProjectTone('dshfiles')).toBe(defaultProjectTone('dshfiles'))
    expect(defaultProjectTone('dshfiles')).toBeGreaterThanOrEqual(0)
    expect(defaultProjectTone('dshfiles')).toBeLessThan(PROJECT_TONE_COUNT)
    expect(new Set(Array.from({ length: 40 }, (_, index) => defaultProjectTone(`project-${index}`))).size).toBe(PROJECT_TONE_COUNT)
  })

  it('reads the project folder out of an absolute path, ignoring trailing separators', () => {
    expect(projectFolderName('/Users/me/NixConfig/')).toBe('NixConfig')
    expect(projectFolderName('C:\\work\\dshfiles')).toBe('dshfiles')
  })

  it('uses the chosen tone, else the automatic one', () => {
    const tones = [{ project: '/Users/me/NixConfig', tone: 4 }]
    expect(projectToneOf('/Users/me/NixConfig/', tones)).toBe(4)
    expect(projectToneOf('/Users/me/other', tones)).toBe(defaultProjectTone('other'))
  })

  it('keeps one entry per project when it is re-imported with another colour', () => {
    const once = upsertProjectTone([], '/Users/me/NixConfig', 2)
    const twice = upsertProjectTone(once, '/Users/me/NixConfig/', 5)
    expect(twice).toEqual([{ project: '/Users/me/NixConfig', tone: 5 }])
  })

  it('names the palette class and colour variable of a tone', () => {
    expect(projectToneClass(3)).toBe('project-tone-balanced-3')
    expect(projectToneClass(7)).toBe('project-tone-balanced-1')
  })
})
