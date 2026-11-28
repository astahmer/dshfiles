// @vitest-environment jsdom
import { identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { AgentChipTone } from '../../../agent-chip-tone.ts'
import { ReferenceChip } from './ReferenceChip.tsx'

const container = document.createElement('div')
let root: Root
let uninstall: (() => void) | undefined

const render = (source: string, reference: string): Element | null => {
  act(() => {
    root.render(<ReferenceChip label={`@${reference}`} invalid={false} source={source} reference={reference} />)
  })
  return container.firstElementChild
}

/** The identity slot a chip paints: the theme's `--dshx-project-balanced-<n>` as its colour, named in `data-tone`. */
const toneOf = (element: Element | null): string | undefined => {
  if (!(element instanceof HTMLElement)) return undefined
  const slot = /--dshx-project-balanced-(\d)/u.exec(element.style.color)?.[1]
  return slot === element.dataset.tone ? slot : `mismatch ${String(slot)} / ${String(element.dataset.tone)}`
}

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => { root.unmount() })
  uninstall?.()
  uninstall = undefined
  container.remove()
  vi.unstubAllGlobals()
})

it('paints an agent mention with the handle’s default colour on its wash before the registry answers', () => {
  const chip = render('agents', 'luna')
  expect(toneOf(chip)).toBe(String(identityToneIndex('luna')))
  expect(chip?.getAttribute('data-agent-tone')).not.toBeNull()
  // One `@`: the label is already `@luna`, so no separate marker doubles it.
  expect(chip?.textContent).toBe('@luna')
  expect(chip?.querySelector('.dshx-project-mark-letters')?.textContent).toBe('@luna')
})

it('repaints with the colour the agent chose once the registry list arrives', async () => {
  const load = vi.fn(() => Promise.resolve(new Map([['luna', 4]])))
  uninstall = AgentChipTone.install(load)
  render('agents', 'luna')
  await act(async () => { await Promise.resolve() })
  expect(toneOf(container.firstElementChild)).toBe('4')
  // Every chip of a draft shares one read.
  render('agents', 'luna')
  expect(load).toHaveBeenCalledTimes(1)
})

it('leaves other references uncoloured', () => {
  const chip = render('files', 'README.md')
  expect(chip?.getAttribute('data-tone')).toBeNull()
  expect(chip instanceof HTMLElement ? chip.style.color : 'missing').toBe('')
})
