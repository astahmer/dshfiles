import { createRef } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PlusIcon } from '@dshfiles/plugin-ui/icons'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@dshfiles/plugin-ui/components/ui/dropdown-menu'
import { SurfaceAction } from './surface-action.js'

afterEach(cleanup)

it('keeps the full action name and forwards focus and click to the actual button', () => {
  const ref = createRef<HTMLButtonElement>()
  const click = vi.fn()
  render(<SurfaceAction ref={ref} label="Add panel" icon={<PlusIcon aria-hidden />} onClick={click} />)
  const button = screen.getByRole('button', { name: 'Add panel' })
  expect(ref.current).toBe(button)
  ref.current?.focus()
  expect(document.activeElement).toBe(button)
  fireEvent.click(button)
  expect(click).toHaveBeenCalledOnce()
  expect(button.getAttribute('title')).toBeNull()
})

it('preserves an asChild menu trigger when its visual label collapses', async () => {
  render(
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <SurfaceAction label="Add panel" icon={<PlusIcon aria-hidden />} />
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem>Editor</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>,
  )
  fireEvent.keyDown(screen.getByRole('button', { name: 'Add panel' }), { key: 'Enter' })
  expect(await screen.findByRole('menuitem', { name: 'Editor' })).toBeTruthy()
})
