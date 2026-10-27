// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DialogHost } from './dialog-host.js'
import { createDialogQueue, type DialogQueue } from './dialog-queue.js'

let queue: DialogQueue

beforeEach(() => {
  // jsdom has no layout; cmdk scrolls the active row into view and Radix measures with ResizeObserver.
  Element.prototype.scrollIntoView = vi.fn()
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  )
  queue = createDialogQueue()
  render(<DialogHost current={queue.current} />)
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const ask = <T,>(open: () => Promise<T>): Promise<T> => {
  let pending: Promise<T> | undefined
  act(() => {
    pending = open()
  })
  if (pending === undefined) throw new Error('the request never started')
  return pending
}

const pressEscape = (): void => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' })
}

describe('confirm', () => {
  it('resolves true from the confirm button', async () => {
    const answer = ask(() => queue.service.confirm({ title: 'Delete it?', confirm: 'Delete' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    await expect(answer).resolves.toBe(true)
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  })

  it('resolves false from cancel', async () => {
    const answer = ask(() => queue.service.confirm({ title: 'Delete it?' }))
    fireEvent.click(await screen.findByRole('button', { name: 'Cancel' }))
    await expect(answer).resolves.toBe(false)
  })

  it('resolves false on Escape', async () => {
    const answer = ask(() => queue.service.confirm({ title: 'Delete it?' }))
    await screen.findByRole('alertdialog')
    pressEscape()
    await expect(answer).resolves.toBe(false)
  })

  it('resolves false on a press outside the dialog', async () => {
    const answer = ask(() => queue.service.confirm({ title: 'Delete it?' }))
    await screen.findByRole('alertdialog')
    fireEvent.pointerDown(document.body)
    await expect(answer).resolves.toBe(false)
  })

  it('styles danger as destructive and starts focus on cancel', async () => {
    void ask(() => queue.service.confirm({ title: 'Wipe?', confirm: 'Wipe', danger: true }))
    const confirm = await screen.findByRole('button', { name: 'Wipe' })
    expect(confirm.className).toContain('dshx:bg-destructive')
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Cancel' })))
  })

  it('starts focus on confirm when not dangerous', async () => {
    void ask(() => queue.service.confirm({ title: 'Continue?', confirm: 'Continue' }))
    const confirm = await screen.findByRole('button', { name: 'Continue' })
    await waitFor(() => expect(document.activeElement).toBe(confirm))
  })
})

describe('alert', () => {
  it('shows one button and resolves when it is pressed', async () => {
    const answer = ask(() => queue.service.alert({ title: 'Saved', description: 'All done.' }))
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog.querySelectorAll('button')).toHaveLength(1)
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await expect(answer).resolves.toBeUndefined()
  })
})

describe('prompt', () => {
  it('ignores an empty submit and resolves the typed value', async () => {
    const answer = ask(() => queue.service.prompt({ title: 'Name' }))
    const field = await screen.findByRole('textbox', { name: 'Name' })
    fireEvent.submit(field.closest('form') ?? field)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.change(field, { target: { value: '   ' } })
    fireEvent.submit(field.closest('form') ?? field)
    expect(screen.getByRole('dialog')).toBeTruthy()
    fireEvent.change(field, { target: { value: 'main' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await expect(answer).resolves.toBe('main')
  })

  it('selects the initial value and hides a secret', async () => {
    void ask(() => queue.service.prompt({ title: 'Token', initial: 'abc', secret: true }))
    await screen.findByRole('dialog')
    const field = document.querySelector('input')
    expect(field?.type).toBe('password')
    await waitFor(() => expect(document.activeElement).toBe(field))
    expect([field?.selectionStart, field?.selectionEnd]).toEqual([0, 3])
  })

  it('resolves undefined on Escape', async () => {
    const answer = ask(() => queue.service.prompt({ title: 'Name', initial: 'x' }))
    await screen.findByRole('dialog')
    pressEscape()
    await expect(answer).resolves.toBeUndefined()
  })
})

describe('select', () => {
  const options = [
    { title: 'Alpha', value: 'alpha', group: 'Letters' },
    { title: 'Beta', description: 'second letter', value: 'beta', group: 'Letters' },
    { title: 'One', value: 'one', group: 'Numbers' },
  ] as const

  it('groups options, marks the current one and resolves the picked value', async () => {
    const answer = ask(() => queue.service.select({ title: 'Pick', options, current: 'beta' }))
    await screen.findByRole('dialog')
    expect(screen.getByText('Letters')).toBeTruthy()
    expect(screen.getByText('Numbers')).toBeTruthy()
    expect(screen.getByRole('option', { name: /Beta/ }).getAttribute('aria-current')).toBe('true')
    fireEvent.click(screen.getByRole('option', { name: /One/ }))
    await expect(answer).resolves.toBe('one')
  })

  it('searches over title and description', async () => {
    void ask(() => queue.service.select({ title: 'Pick', options }))
    const search = await screen.findByRole('combobox')
    fireEvent.change(search, { target: { value: 'second' } })
    await waitFor(() => expect(screen.queryAllByRole('option').map(option => option.textContent)).toEqual(['Betasecond letter']))
  })

  it('resolves undefined on Escape', async () => {
    const answer = ask(() => queue.service.select({ title: 'Pick', options }))
    await screen.findByRole('dialog')
    pressEscape()
    await expect(answer).resolves.toBeUndefined()
  })
})

describe('queue', () => {
  it('opens one request at a time, in arrival order', async () => {
    const first = ask(() => queue.service.confirm({ title: 'First?' }))
    const second = ask(() => queue.service.prompt({ title: 'Second' }))
    await screen.findByText('First?')
    expect(screen.queryByText('Second')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm' }))
    await expect(first).resolves.toBe(true)
    const field = await screen.findByRole('textbox', { name: 'Second' })
    fireEvent.change(field, { target: { value: 'ok' } })
    fireEvent.click(screen.getByRole('button', { name: 'OK' }))
    await expect(second).resolves.toBe('ok')
  })

  it('cancels every open and waiting request when disposed', async () => {
    const first = ask(() => queue.service.confirm({ title: 'First?' }))
    const second = ask(() => queue.service.select({ title: 'Pick', options: [{ title: 'A', value: 'a' }] }))
    act(() => queue.dispose())
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBeUndefined()
  })
})
