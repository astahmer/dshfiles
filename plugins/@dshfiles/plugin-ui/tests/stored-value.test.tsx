import { act, render, screen } from '@testing-library/react'
import { Schema } from 'effect'
import { afterEach, describe, expect, it } from 'vitest'
import { createStoredValue } from '../src/hooks/stored-value.js'

const KEY = 'plugin-ui.test.stored'

type ParseResult<Value> = { readonly success: true; readonly data: Value } | { readonly success: false }

const countSchema = {
  // oxlint-disable-next-line antislop/no-unknown-parameters -- This is the decode boundary: the schema parses the stored JSON value.
  safeParse: (value: unknown): ParseResult<{ count: number }> => {
    const count = typeof value === 'object' && value !== null && 'count' in value ? value.count : undefined
    return typeof count === 'number' && Number.isInteger(count) ? { success: true, data: { count } } : { success: false }
  },
}

const stringSchema = {
  // oxlint-disable-next-line antislop/no-unknown-parameters -- This is the decode boundary: the schema parses the stored JSON value.
  safeParse: (value: unknown): ParseResult<string> => (typeof value === 'string' ? { success: true, data: value } : { success: false }),
}

afterEach(() => localStorage.clear())

describe('createStoredValue', () => {
  it('reads the fallback for missing, non-JSON and schema-invalid values', () => {
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: null }).get()).toBeNull()
    localStorage.setItem(KEY, '{not json')
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: null }).get()).toBeNull()
    localStorage.setItem(KEY, JSON.stringify({ count: 'many' }))
    expect(createStoredValue({ key: KEY, schema: countSchema, fallback: { count: 0 } }).get()).toEqual({ count: 0 })
  })

  it('decodes and validates through an Effect schema', () => {
    const effectCount = Schema.Struct({ count: Schema.Int })
    localStorage.setItem(KEY, JSON.stringify({ count: 3 }))
    const stored = createStoredValue({ key: KEY, schema: effectCount, fallback: null })
    const value: { readonly count: number } | null = stored.get()
    expect(value).toEqual({ count: 3 })
    expect(stored.set({ count: 1.5 })).toBe(false)
    expect(stored.set({ count: 4 })).toBe(true)
    expect(localStorage.getItem(KEY)).toBe(JSON.stringify({ count: 4 }))
    localStorage.setItem(KEY, JSON.stringify({ count: 'many' }))
    stored.reload()
    expect(stored.get()).toBeNull()
  })

  it('accepts a legacy bare string when the schema takes strings', () => {
    localStorage.setItem(KEY, '/repo/path')
    expect(createStoredValue({ key: KEY, schema: stringSchema, fallback: '' }).get()).toBe('/repo/path')
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
