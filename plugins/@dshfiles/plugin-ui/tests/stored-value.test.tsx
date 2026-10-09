import { act, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createStoredValue } from '../src/hooks/stored-value.js'

const KEY = 'plugin-ui.test.stored'
const countSchema = z.object({ count: z.number().int() })

afterEach(() => localStorage.clear())

describe('createStoredValue', () => {
  it('reads the fallback for missing, non-JSON and schema-invalid values', () => {
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: null }).get()).toBeNull()
    localStorage.setItem(KEY, '{not json')
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: null }).get()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ count: 'many' }))
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: { count: 0 } }).get()).toEqual({ count: 0 })
  })

  it('accepts a legacy bare string when the schema takes strings', () => {
    localStorage.setItem(KEY, '/repo/path')
    expect(createStoredValue({ key: KEY, schema: z.string(), fallback: '' }).get()).toBe('/repo/path')
  })

  it('persists valid writes and rejects invalid ones', () => {
    const stored = createStoredValue({ key: KEY, schema: countSchema, fallback: null })
    expect(stored.set({ count: 2 })).toBe(true)
    expect(JSON.parse(localStorage.getItem(KEY) ?? '')).toEqual({ count: 2 })
    expect(stored.set({ count: 1.5 })).toBe(false)
    expect(stored.get()).toEqual({ count: 2 })
  })

  it('keeps the value in memory and reports false when storage refuses the write', () => {
    const stored = createStoredValue({
      key: KEY,
      schema: countSchema,
      fallback: null,
      storage: () => ({
        getItem: () => null,
        setItem: () => {
          throw new Error('QuotaExceededError')
        },
        removeItem: () => {},
      }),
    })
    expect(stored.set({ count: 3 })).toBe(false)
    expect(stored.get()).toEqual({ count: 3 })
  })

  it('follows another tab through the storage event', () => {
    const stored = createStoredValue({ key: KEY, schema: countSchema, fallback: { count: 0 } })
    const Count = () => <span data-testid="count">{stored.useValue().count}</span>
    const view = render(<Count />)
    expect(screen.getByTestId('count').textContent).toBe('0')

    act(() => {
      localStorage.setItem(KEY, JSON.stringify({ count: 7 }))
      window.dispatchEvent(new StorageEvent('storage', { key: KEY }))
    })
    expect(screen.getByTestId('count').textContent).toBe('7')

    act(() => {
      localStorage.setItem(KEY, JSON.stringify({ count: 8 }))
      window.dispatchEvent(new StorageEvent('storage', { key: 'another.key' }))
    })
    expect(screen.getByTestId('count').textContent).toBe('7')
    view.unmount()
  })

  it('remove clears storage and returns to the fallback', () => {
    const stored = createStoredValue({ key: KEY, schema: countSchema, fallback: null })
    stored.set({ count: 4 })
    stored.remove()
    expect(localStorage.getItem(KEY)).toBeNull()
    expect(stored.get()).toBeNull()
  })
})
