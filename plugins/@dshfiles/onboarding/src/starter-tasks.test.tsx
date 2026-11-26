// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { StarterTaskCards, StarterTasks } from './starter-tasks.js'

afterEach(cleanup)

describe('StarterTaskCards', () => {
  it('offers three first tasks for the project on screen and inserts the chosen prompt without sending it', () => {
    const insert = vi.fn()
    render(<StarterTaskCards beforeFirstThread insert={insert} project="sample" />)
    expect(screen.getByText('Pick a first task for sample; it goes into the composer and nothing is sent.')).toBeTruthy()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Explain the project', 'Find a rough edge', 'Add a missing test'])
    fireEvent.click(screen.getByRole('button', { name: 'Find a rough edge' }))
    expect(insert).toHaveBeenCalledExactlyOnceWith('Find one small bug or rough edge in sample and propose a fix before changing anything.')
  })

  it('keeps the three chips once a thread has a message, without the first-task sentence (round five B8)', () => {
    const insert = vi.fn()
    render(<StarterTaskCards beforeFirstThread={false} insert={insert} project="sample" />)
    expect(screen.queryByText(/Pick a first task/u)).toBeNull()
    expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['Explain the project', 'Find a rough edge', 'Add a missing test'])
    fireEvent.click(screen.getByRole('button', { name: 'Explain the project' }))
    expect(insert).toHaveBeenCalledExactlyOnceWith('Explain how sample is organised and where I should start reading.')
  })

  it('stays quiet when no project is on screen', () => {
    const { container } = render(<StarterTaskCards beforeFirstThread insert={() => undefined} project={null} />)
    expect(container.childElementCount).toBe(0)
  })
})

describe('StarterTasks.beforeFirstThread', () => {
  it('counts only top-level threads with a message', () => {
    const blank = { blank: true }
    const sent = { blank: false }
    expect(StarterTasks.beforeFirstThread({ ids: [], byId: {} })).toBe(true)
    expect(StarterTasks.beforeFirstThread({ ids: ['a', 'b'], byId: { a: blank, b: { blank: false, parentId: 'a' } } })).toBe(true)
    expect(StarterTasks.beforeFirstThread({ ids: ['a', 'b'], byId: { a: blank, b: sent } })).toBe(false)
  })
})

describe('the starter line (round five C4, council round 3)', () => {
  it('sets at most three starters on a line of their own, in the hero chip style, each with a 20px identity-tone tile (council round 13 C6)', () => {
    const { container } = render(<StarterTaskCards beforeFirstThread={false} insert={() => undefined} project="sample" />)
    const line = container.querySelector<HTMLElement>('[data-starter-row]')
    expect(line).not.toBeNull()
    expect(line?.className).toContain('dshx:basis-full')
    // The hero's divider is a full-basis line at the head of this row: the row must wrap.
    expect(line?.className).toContain('dshx:flex-wrap')
    const chips = [...(line?.querySelectorAll<HTMLButtonElement>('button') ?? [])]
    expect(chips).toHaveLength(3)
    for (const chip of chips) {
      const classes = chip.className.split(/\s+/u)
      // One chip style with Resume and Inbox: 32px, radius 8, raised fill, no border, 12px padding, 8px gap.
      for (const token of ['dshx:h-8', 'dshx:rounded-lg', 'dshx:bg-secondary', 'dshx:border-0', 'dshx:px-3', 'dshx:gap-2', 'dshx:hover:bg-(--dshx-tone-selected)']) expect(classes).toContain(token)
      expect(classes).not.toContain('dshx:bg-transparent')
      const tile = chip.querySelector<HTMLElement>('[data-starter-tile]')
      expect(tile?.className).toContain('dshx:size-5')
      expect(tile?.className).toMatch(/dshx:bg-identity-\d\/14 dshx:text-identity-\d/u)
      // Green (identity 5) sits beside the success hue: never on a starter.
      expect(tile?.className).not.toContain('identity-5')
    }
    expect(new Set(chips.map(chip => chip.querySelector('[data-starter-tile]')?.className)).size).toBe(3)
  })
})
