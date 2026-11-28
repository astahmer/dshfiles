import { projectToneIndex } from '@dshfiles/plugin-ui/components/ui/project-mark'
import { expect, test } from 'vitest'
import { PaletteProjectColorsModel } from './palette-project-colors.js'
import { projectTextTone } from './project-tone.js'

const saved = new Map<string, { readonly className?: string; readonly color?: string; readonly tone?: number }>([
  ['/dev/welii', { color: '#ffd400' }],
  ['/dev/billing-api', { className: 'project-tone-balanced-2', tone: 2 }],
])
const source = PaletteProjectColorsModel.sourceOf({ savedChipOf: path => saved.get(path), palette: 'cool' })

test('the palette gets the tile a thread row paints for the same project', () => {
  // A picked colour wins, keyed by the project folder, exactly as the row's tile resolves it.
  expect(source.colorOf({ path: '/dev/welii', title: 'welii' })).toEqual({ color: '#ffd400' })
  // A picked tone is a balanced-palette tone, as the row's.
  expect(source.colorOf({ path: '/dev/billing-api', title: 'billing-api' })).toEqual({ className: 'project-tone-balanced-2', tone: 2, palette: 'balanced' })
  // Otherwise the name's tone in the list's chosen palette, the tone the row's ProjectMark hashes to.
  const hashed = { className: projectTextTone('dshfiles', 'cool'), tone: projectToneIndex('dshfiles'), palette: 'cool' }
  expect(source.colorOf({ path: '/dev/dshfiles', title: 'dshfiles' })).toEqual(hashed)
  expect(source.colorOf({ path: undefined, title: 'dshfiles' })).toEqual(hashed)
})

test('a thread without a project gets no colour', () => {
  expect(source.colorOf({ path: undefined, title: '' })).toBeUndefined()
})
