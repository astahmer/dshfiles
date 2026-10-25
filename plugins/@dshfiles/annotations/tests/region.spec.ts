import { describe, expect, it } from 'vitest'
import { describeRegion } from '../src/region.js'

const mount = (html: string): HTMLElement => {
  const host = document.createElement('div')
  host.innerHTML = html
  document.body.append(host)
  return host
}

describe('describeRegion', () => {
  it('normalizes a drag in any direction', () => {
    const host = mount('<section class="panel"><p>Body</p></section>')
    const section = host.querySelector('section')
    if (section === null) throw new Error('fixture missing')
    const target = describeRegion({
      element: section,
      surface: 'dsh',
      url: 'http://127.0.0.1:3080/',
      rect: { x: 120, y: 90, width: -40, height: -20 },
    })
    expect(target?.rect).toEqual({ x: 80, y: 70, width: 40, height: 20 })
    expect(target?.selector).toContain('section.panel')
  })

  it('refuses a private or form target', () => {
    const host = mount('<div data-private><p>x</p></div><textarea></textarea>')
    const paragraph = host.querySelector('p')
    const textarea = host.querySelector('textarea')
    if (paragraph === null || textarea === null) throw new Error('fixture missing')
    expect(describeRegion({ element: paragraph, surface: 'dsh', url: 'http://127.0.0.1:3080/', rect: { x: 0, y: 0, width: 5, height: 5 } })).toBeNull()
    expect(describeRegion({ element: textarea, surface: 'dsh', url: 'http://127.0.0.1:3080/', rect: { x: 0, y: 0, width: 5, height: 5 } })).toBeNull()
  })
})
