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
