import { describe, expect, it } from 'vitest'
import { projectTextTone } from './project-tone.js'

describe('project text tones', () => {
  it('keeps project tones stable and avoids the error-red chart color by default', () => {
    expect(projectTextTone('home-infra')).toBe(projectTextTone('home-infra'))
    expect(projectTextTone('home-infra')).not.toContain('chart-4')
  })

  it('offers a configurable cool palette with six theme-aware colors', () => {
    const tones = Array.from({ length: 100 }, (_, index) => projectTextTone(`project-${index}`, 'cool'))
    expect(new Set(tones).size).toBe(6)
    expect(tones.every(tone => tone.startsWith('project-tone-cool-'))).toBe(true)
  })
})
