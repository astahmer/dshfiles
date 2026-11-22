import { describe, expect, it } from 'vitest'
import { ProjectTone } from './project-tone.js'

describe('project colours', () => {
  it('gives a project the same automatic tone on every import', () => {
    expect(ProjectTone.defaultTone('dshfiles')).toBe(ProjectTone.defaultTone('dshfiles'))
    expect(ProjectTone.defaultTone('dshfiles')).toBeGreaterThanOrEqual(0)
    expect(ProjectTone.defaultTone('dshfiles')).toBeLessThan(ProjectTone.count)
    expect(new Set(Array.from({ length: 40 }, (_, index) => ProjectTone.defaultTone(`project-${index}`))).size).toBe(ProjectTone.count)
    expect(ProjectTone.defaultColor('dshfiles')).toEqual({ kind: 'tone', tone: ProjectTone.defaultTone('dshfiles') })
  })

  it('reads the project folder out of an absolute path, ignoring trailing separators', () => {
    expect(ProjectTone.projectFolderName('/Users/me/NixConfig/')).toBe('NixConfig')
    expect(ProjectTone.projectFolderName('C:\\work\\dshfiles')).toBe('dshfiles')
  })

  it('uses the chosen tone, then a custom colour, else the automatic tone', () => {
    const tones = [{ project: '/Users/me/NixConfig', tone: 4, color: '' }]
    const custom = [{ project: '/Users/me/NixConfig', tone: 0, color: '#12ab34' }]
    expect(ProjectTone.colorOf('/Users/me/NixConfig/', tones)).toEqual({ kind: 'tone', tone: 4 })
    expect(ProjectTone.colorOf('/Users/me/NixConfig/', custom)).toEqual({ kind: 'custom', color: '#12ab34' })
    expect(ProjectTone.colorOf('/Users/me/other', tones)).toEqual({ kind: 'tone', tone: ProjectTone.defaultTone('other') })
    expect(ProjectTone.savedColorOf('/Users/me/other', tones)).toBeUndefined()
    expect(ProjectTone.savedColorOf('/Users/me/NixConfig/', custom)).toEqual({ kind: 'custom', color: '#12ab34' })
  })

  it('keeps one entry per project and writes either the tone or the custom colour', () => {
    const once = ProjectTone.upsertColor([], '/Users/me/NixConfig', { kind: 'tone', tone: 2 })
    expect(once).toEqual([{ project: '/Users/me/NixConfig', tone: 2, color: '' }])
    const twice = ProjectTone.upsertColor(once, '/Users/me/NixConfig/', { kind: 'custom', color: '#AABBCC' })
    expect(twice).toEqual([{ project: '/Users/me/NixConfig', tone: 0, color: '#aabbcc' }])
  })

  it('accepts only well-formed hex colours', () => {
    expect(ProjectTone.isCustomColor('#12ab34')).toBe(true)
    expect(ProjectTone.isCustomColor('#AABBCC')).toBe(true)
    expect(ProjectTone.isCustomColor('12ab34')).toBe(false)
    expect(ProjectTone.isCustomColor('#12ab3')).toBe(false)
    expect(ProjectTone.isCustomColor('')).toBe(false)
  })

  it('names the palette class and colour variable of a tone', () => {
    expect(ProjectTone.toneClass(3)).toBe('project-tone-balanced-3')
    expect(ProjectTone.toneClass(7)).toBe('project-tone-balanced-1')
    expect(ProjectTone.toneColor(3)).toBe('var(--dshx-project-balanced-3)')
  })
})
