// @vitest-environment jsdom
import { identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test, vi } from 'vitest'
import { TagChip } from './tag-chip.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const render = (chosen: number | undefined) => {
  const onChoose = vi.fn()
  const openRow = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() =>
    root?.render(
      <div onClick={openRow}>
        <TagChip tag="billing" chosen={chosen} onChoose={onChoose} className="project-tone-balanced-1" />
      </div>,
    ),
  )
  return { onChoose, openRow }
}

const chip = (): HTMLButtonElement => {
  const element = document.querySelector<HTMLButtonElement>('[data-tag-chip="billing"]')
  if (element === null) throw new Error('No tag chip')
  return element
}

const swatch = (slot: number): HTMLButtonElement => {
  const element = document.querySelector<HTMLButtonElement>(`[role="radiogroup"][aria-label="Colour of #billing"] [data-palette-slot="${String(slot)}"]`)
  if (element === null) throw new Error(`No swatch ${String(slot)}`)
  return element
}

const resetButton = (): HTMLButtonElement | undefined =>
  [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Use default colour')

test("a tag chip is a button named after the tag that opens the tag's colour menu, without opening the row", () => {
  const { openRow } = render(undefined)
  expect(chip().textContent).toBe('#billing')
  expect(chip().getAttribute('aria-label')).toBe('#billing colour')
  expect(chip().className).toContain('project-tone-balanced-1')
  act(() => chip().click())
  expect(openRow).not.toHaveBeenCalled()
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Colour of #billing')
  // Nothing chosen: the tag's hashed slot is marked as the default, and there is no default to return to.
  expect(swatch(identityToneIndex('billing')).dataset['state']).toBe('default')
  expect(resetButton()?.disabled).toBe(true)
})

test('picking a swatch chooses its slot, and "Use default colour" clears a chosen one', () => {
  const { onChoose, openRow } = render(4)
  act(() => chip().click())
  expect(swatch(4).getAttribute('aria-checked')).toBe('true')
  act(() => swatch(2).click())
  expect(onChoose).toHaveBeenLastCalledWith(2)
  const reset = resetButton()
  expect(reset?.disabled).toBe(false)
  act(() => reset?.click())
  expect(onChoose).toHaveBeenLastCalledWith(null)
  expect(openRow).not.toHaveBeenCalled()
})
