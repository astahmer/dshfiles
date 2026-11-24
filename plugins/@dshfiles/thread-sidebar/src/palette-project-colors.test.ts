import { expect, test } from 'vitest'
import { PaletteProjectColorsModel } from './palette-project-colors.js'
import { projectTextTone } from './project-tone.js'

const saved = new Map([['/dev/welii', { color: '#ffd400' }]])
const source = PaletteProjectColorsModel.sourceOf({ savedChipOf: path => saved.get(path), palette: 'cool' })

test('the palette gets the colour a thread row paints for the same project', () => {
  // A picked colour wins, keyed by the project folder, exactly as the row's chip resolves it.
  expect(source.colorOf({ path: '/dev/welii', title: 'welii' })).toEqual({ color: '#ffd400' })
  // Otherwise the name's tone in the list's chosen palette, the class the row's project name wears.
  expect(source.colorOf({ path: '/dev/dshfiles', title: 'dshfiles' })).toEqual({ className: projectTextTone('dshfiles', 'cool') })
  expect(source.colorOf({ path: undefined, title: 'dshfiles' })).toEqual({ className: projectTextTone('dshfiles', 'cool') })
})

test('a thread without a project gets no colour', () => {
  expect(source.colorOf({ path: undefined, title: '' })).toBeUndefined()
})
