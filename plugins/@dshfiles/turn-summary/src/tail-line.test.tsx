// @vitest-environment jsdom
import { act } from 'react'
import { createRoot } from 'react-dom/client'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { TurnFileChips } from './turn-file-chips.js'

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
afterEach(() => {
  document.body.innerHTML = ''
})

const file = (path: string) => ({ path, added: 2, removed: 2 })
const render = async (count: number): Promise<HTMLElement> => {
  const host = document.createElement('div')
  document.body.append(host)
  const files = Array.from({ length: count }, (_, index) => file(`src/f${String(index)}.ts`))
  await act(async () => createRoot(host).render(<TurnFileChips files={files} onOpen={() => undefined} opensChanges onMore={() => undefined} moreOpen={false} />))
  return host
}

// Round five C2 (council round 4): the summary names the turn's files once, so the changed-files card (deliverables)
// steps aside when every file has its chip, and the reply's hover actions ride the line's trailing end (chat).
describe('the turn summary line as a tail row', () => {
  it('says whether its chips name every edited file', async () => {
    expect((await render(2)).querySelector('[data-dshfiles-turn-file-chips]')?.getAttribute('data-dshfiles-turn-file-chips')).toBe('all')
    expect((await render(6)).querySelector('[data-dshfiles-turn-file-chips]')?.getAttribute('data-dshfiles-turn-file-chips')).toBe('some')
  })

  it("marks its root as chat's one-line tail row", () => {
    const line = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), 'turn-summary-line.tsx'), 'utf8')
    expect(line).toMatch(/data-dshfiles-turn-summary="" data-chat-tail-line=""/u)
  })
})
