// @vitest-environment jsdom
// @vitest-environment-options {"pretendToBeVisual":true}
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { VibeBridgeSwitch } from './vibe-bridge-switch.js'

const views: { root: Root; container: HTMLDivElement }[] = []
afterEach(async () => {
  for (const view of views.splice(0)) {
    await act(async () => view.root.unmount())
    view.container.remove()
  }
})
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

const mount = async (bridge: 'acp' | 'headless', onChange = vi.fn()) => {
  const container = document.createElement('div')
  document.body.append(container)
  const root = createRoot(container)
  views.push({ root, container })
  await act(async () => {
    root.render(<VibeBridgeSwitch bridge={bridge} disabled={false} onChange={onChange} />)
  })
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('button')]
  return { container, buttons, onChange }
}

it('shows the account s bridge and switches it when the other transport is chosen', async () => {
  const { buttons, onChange } = await mount('headless')
  expect(buttons.map(button => button.textContent)).toEqual(['Headless CLI', 'ACP host tools'])
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['true', 'false'])
  await act(async () => buttons[1]?.click())
  expect(onChange).toHaveBeenCalledWith('acp')
})

it('leaves the choice alone when the selected transport is clicked again', async () => {
  const { buttons, onChange } = await mount('acp')
  expect(buttons.map(button => button.getAttribute('aria-pressed'))).toEqual(['false', 'true'])
  await act(async () => buttons[1]?.click())
  expect(onChange).not.toHaveBeenCalled()
})
