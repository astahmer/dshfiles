import { describe, expect, it } from 'vitest'

import { CaptureProject } from './capture-project.js'

describe('capture project', () => {
  it('starts from the header scope, then the remembered project while remembering is on', () => {
    expect(CaptureProject.initial({ filter: '/work/one', remembered: '/work/two', reuse: true })).toBe('/work/one')
    expect(CaptureProject.initial({ filter: null, remembered: '/work/two', reuse: true })).toBe('/work/two')
    expect(CaptureProject.initial({ filter: null, remembered: '/work/two', reuse: false })).toBeNull()
  })

  it('keeps the project it just used, and forgets it when remembering is off', () => {
    expect(CaptureProject.next({ sent: '/work/one', filter: null, reuse: true })).toBe('/work/one')
    expect(CaptureProject.next({ sent: '/work/one', filter: '/work/two', reuse: false })).toBe('/work/two')
    expect(CaptureProject.next({ sent: '/work/one', filter: null, reuse: false })).toBeNull()
    expect(CaptureProject.remembered({ sent: '/work/one', reuse: true })).toBe('/work/one')
    expect(CaptureProject.remembered({ sent: '/work/one', reuse: false })).toBeNull()
  })
})
