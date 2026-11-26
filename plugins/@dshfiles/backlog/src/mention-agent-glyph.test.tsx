// @vitest-environment jsdom
import { identityToneClass, identityToneIndex } from '@dshfiles/plugin-ui/components/palette-picker'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeAll, expect, test } from 'vitest'
import { MentionAgentGlyph } from './mention-completion.js'

let root: Root | undefined
let host: HTMLElement | undefined

beforeAll(() => {
  Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(() => {
  act(() => root?.unmount())
  host?.remove()
})

const render = (props: Parameters<typeof MentionAgentGlyph>[0]): HTMLElement => {
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  act(() => root?.render(<MentionAgentGlyph {...props} />))
  const glyph = host.querySelector<HTMLElement>('[data-agent-glyph]')
  if (glyph === null) throw new Error('No agent glyph')
  return glyph
}

test("an agent's @ row glyph sits on its identity tile, coloured from its handle when it has no chosen slot", () => {
  const glyph = render({ handle: 'rev', glyph: '🔎', tone: undefined })
  expect(glyph.textContent).toBe('🔎')
  expect(glyph.getAttribute('aria-hidden')).toBe('true')
  for (const look of ['dshx:inline-flex', 'dshx:h-5', 'dshx:min-w-5', 'dshx:justify-center', 'dshx:rounded-sm', 'dshx:bg-current/18'])
    expect(glyph.className).toContain(look)
  expect(glyph.className).toContain(identityToneClass(identityToneIndex('rev')))
})

test("an agent's chosen slot wins over the hashed one, and a missing glyph falls back to the robot", () => {
  const chosen = (identityToneIndex('rev') + 2) % 6
  const glyph = render({ handle: 'rev', glyph: undefined, tone: chosen })
  expect(glyph.className).toContain(identityToneClass(chosen))
  expect(glyph.className).not.toContain(identityToneClass(identityToneIndex('rev')))
  expect(glyph.textContent).toBe('🤖')
})
