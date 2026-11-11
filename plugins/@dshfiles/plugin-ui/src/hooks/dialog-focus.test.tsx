// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, expect, test } from 'vitest'
import { useDialogFocus } from './dialog-focus.js'

afterEach(cleanup)

const Surface = (props: { readonly open: boolean; readonly trap?: boolean }): JSX.Element => {
  const ref = useRef<HTMLElement>(null)
  useDialogFocus({ open: props.open, container: ref, trap: props.trap ?? false })
  return (
    <>
      <button type="button">Trigger</button>
      <section hidden={!props.open} ref={ref} role="dialog" aria-label="Surface">
        <button type="button">First</button>
        <button type="button">Last</button>
      </section>
    </>
  )
}

test('moves focus into the surface on open and returns it to the trigger on close', () => {
  const view = render(<Surface open={false} />)
  const trigger = screen.getByRole('button', { name: 'Trigger' })
  trigger.focus()
  view.rerender(<Surface open />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
  view.rerender(<Surface open={false} />)
  expect(document.activeElement).toBe(trigger)
})

test('returns focus when the surface unmounts', () => {
  const Host = (props: { readonly shown: boolean }): JSX.Element => (
    <>
      <button type="button">Opener</button>
      {props.shown ? <Surface open /> : null}
    </>
  )
  const view = render(<Host shown={false} />)
  const opener = screen.getByRole('button', { name: 'Opener' })
  opener.focus()
  view.rerender(<Host shown />)
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'First' }))
  view.rerender(<Host shown={false} />)
  expect(document.activeElement).toBe(opener)
})

test('focuses the requested element first', () => {
  const Searchable = (): JSX.Element => {
    const ref = useRef<HTMLElement>(null)
    const search = useRef<HTMLInputElement>(null)
    useDialogFocus({ open: true, container: ref, initialFocus: search })
    return (
      <section ref={ref}>
        <button type="button">Close</button>
        <input aria-label="Search" ref={search} />
      </section>
    )
  }
  render(<Searchable />)
  expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Search' }))
})

test('keeps Tab inside a trapped surface', () => {
  render(<Surface open trap />)
  const first = screen.getByRole('button', { name: 'First' })
  const last = screen.getByRole('button', { name: 'Last' })
  last.focus()
  fireEvent.keyDown(last, { key: 'Tab' })
  expect(document.activeElement).toBe(first)
  fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(last)
})
