// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { OpenSidebarButton } from './open-sidebar-button.js'

afterEach(cleanup)

it('names the way back to a hidden sidebar, carries its chord and opens it', () => {
  const onOpen = vi.fn()
  render(<OpenSidebarButton label="Open sidebar" onOpen={onOpen} />)
  const button = screen.getByRole('button', { name: 'Open sidebar' })
  expect(button.getAttribute('aria-keyshortcuts')).toMatch(/\+B$/u)
  expect(button.className).toContain('dshx-hit-44')
  fireEvent.click(button)
  expect(onOpen).toHaveBeenCalledTimes(1)
})
