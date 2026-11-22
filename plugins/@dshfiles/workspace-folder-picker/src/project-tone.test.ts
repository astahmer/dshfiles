import { describe, expect, it } from 'vitest'
import {
  defaultProjectColor,
  defaultProjectTone,
  isProjectColor,
  projectColorOf,
  projectFolderName,
  PROJECT_TONE_COUNT,
  projectToneClass,
  projectToneColor,
  upsertProjectColor,
} from './project-tone.js'

describe('project colours', () => {
  it('gives a project the same automatic tone on every import', () => {
    expect(defaultProjectTone('dshfiles')).toBe(defaultProjectTone('dshfiles'))
    expect(defaultProjectTone('dshfiles')).toBeGreaterThanOrEqual(0)
    expect(defaultProjectTone('dshfiles')).toBeLessThan(PROJECT_TONE_COUNT)
    expect(new Set(Array.from({ length: 40 }, (_, index) => defaultProjectTone(`project-${index}`))).size).toBe(PROJECT_TONE_COUNT)
    expect(defaultProjectColor('dshfiles')).toEqual({ kind: 'tone', tone: defaultProjectTone('dshfiles') })
  })

  it('reads the project folder out of an absolute path, ignoring trailing separators', () => {
    expect(projectFolderName('/Users/me/NixConfig/')).toBe('NixConfig')
    expect(projectFolderName('C:\\work\\dshfiles')).toBe('dshfiles')
  })

  it('uses the chosen tone, then a custom colour, else the automatic tone', () => {
    const tones = [{ project: '/Users/me/NixConfig', tone: 4, color: '' }]
    const custom = [{ project: '/Users/me/NixConfig', tone: 0, color: '#12ab34' }]
    expect(projectColorOf('/Users/me/NixConfig/', tones)).toEqual({ kind: 'tone', tone: 4 })
    expect(projectColorOf('/Users/me/NixConfig/', custom)).toEqual({ kind: 'custom', color: '#12ab34' })
    expect(projectColorOf('/Users/me/other', tones)).toEqual({ kind: 'tone', tone: defaultProjectTone('other') })
  })

  it('keeps one entry per project and writes either the tone or the custom colour', () => {
    const once = upsertProjectColor([], '/Users/me/NixConfig', { kind: 'tone', tone: 2 })
    expect(once).toEqual([{ project: '/Users/me/NixConfig', tone: 2, color: '' }])
    const twice = upsertProjectColor(once, '/Users/me/NixConfig/', { kind: 'custom', color: '#AABBCC' })
    expect(twice).toEqual([{ project: '/Users/me/NixConfig', tone: 0, color: '#aabbcc' }])
  })

  it('accepts only well-formed hex colours', () => {
    expect(isProjectColor('#12ab34')).toBe(true)
    expect(isProjectColor('#AABBCC')).toBe(true)
    expect(isProjectColor('12ab34')).toBe(false)
    expect(isProjectColor('#12ab3')).toBe(false)
    expect(isProjectColor('')).toBe(false)
  })

  it('names the palette class and colour variable of a tone', () => {
    expect(projectToneClass(3)).toBe('project-tone-balanced-3')
    expect(projectToneClass(7)).toBe('project-tone-balanced-1')
    expect(projectToneColor(3)).toBe('var(--dshx-project-balanced-3)')
  })
})
