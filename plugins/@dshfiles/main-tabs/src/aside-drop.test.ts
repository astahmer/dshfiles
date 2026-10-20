// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { asideDropColumn } from './aside-drop.js'

const stubHit = (element: Element | null): void => {
  Object.defineProperty(document, 'elementFromPoint', { configurable: true, value: () => element })
}

const seedSidebar = () => {
  document.body.innerHTML = [
    '<div data-rightbar-col><div data-slot="rightbar"><div id="panel"><button id="chip">Thread</button></div></div></div>',
    '<div data-slot="main"><div id="conversation">Thread</div></div>',
  ].join('')
  const column = document.querySelector<HTMLElement>('[data-rightbar-col]')
  const chip = document.querySelector<HTMLElement>('#chip')
  if (column === null || chip === null) throw new Error('The seeded sidebar is incomplete.')
  return { column, chip }
}

describe('asideDropColumn', () => {
  afterEach(() => {
    Reflect.deleteProperty(document, 'elementFromPoint')
    document.body.innerHTML = ''
  })

  it('answers with the right column while the pointer is over the native right sidebar', () => {
    const { column, chip } = seedSidebar()
    stubHit(chip)

    expect(asideDropColumn(document, { x: 900, y: 120 })).toBe(column)
  })

  it('answers nothing over the main view, the frame without the sidebar, or a page that does not hit-test', () => {
    seedSidebar()
    stubHit(document.querySelector('#conversation'))
    expect(asideDropColumn(document, { x: 500, y: 120 })).toBeNull()

    stubHit(null)
    expect(asideDropColumn(document, { x: 900, y: 120 })).toBeNull()

    Reflect.deleteProperty(document, 'elementFromPoint')
    expect(asideDropColumn(document, { x: 900, y: 120 })).toBeNull()
  })

  it('ignores a rightbar outlet outside the frame right column', () => {
    document.body.innerHTML = '<div data-slot="rightbar"><button id="chip">Thread</button></div>'
    stubHit(document.querySelector('#chip'))

    expect(asideDropColumn(document, { x: 900, y: 120 })).toBeNull()
  })
})
