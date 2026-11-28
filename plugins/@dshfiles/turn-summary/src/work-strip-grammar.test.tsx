// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnWalkthroughToggle } from './turn-walkthrough.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => {
  document.body.innerHTML = ''
})

const here = dirname(fileURLToPath(import.meta.url))
const line = readFileSync(resolve(here, 'turn-summary-line.tsx'), 'utf8')
const walkthrough = readFileSync(resolve(here, 'turn-walkthrough.tsx'), 'utf8')

// Council round 7 C5: "ran 2 commands › · read 1 file" mixed two grammars. Parts are separated by "·" only; a part that
// opens a list reads as a link, underlined on hover and while its list is open.
describe('the work strip grammar (council round 7 C5)', () => {
  it('draws no disclosure chevron on any part', () => {
    expect(line).not.toMatch(/Chevron(Right|Down)Icon/u)
    expect(walkthrough.slice(walkthrough.indexOf('export const TurnWalkthroughToggle'), walkthrough.indexOf('export const TurnWalkthroughList'))).not.toMatch(
      /Chevron(Right|Down)Icon/u,
    )
  })

  it('underlines a part that opens a list on hover, and keeps it underlined while open', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    await act(async () => createRoot(host).render(<TurnWalkthroughToggle open onToggle={() => undefined} />))
    const button = host.querySelector('button')
    expect(button?.querySelector('.lucide-chevron-down, .lucide-chevron-right')).toBeNull()
    expect(button?.className).toContain('dshx:hover:underline')
    expect(button?.className).toContain('dshx:aria-expanded:underline')
    const toggle = line.slice(line.indexOf('const Toggle = '), line.indexOf('const FileList = '))
    expect(toggle).toContain('dshx:hover:underline')
    expect(toggle).toContain('dshx:aria-expanded:underline')
  })
})
